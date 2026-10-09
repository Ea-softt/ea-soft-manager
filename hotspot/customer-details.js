const mac = value => String(value || '').replace(/[^a-f0-9]/gi, '').toUpperCase();
const fields = (row, names) => Object.fromEntries(names.filter(name => row[name] !== undefined).map(name => [name, row[name]]));
const DEVICE_TYPES = ['Android phone', 'iPhone', 'Phone', 'iPad', 'Android tablet', 'Tablet', 'Windows computer', 'Mac computer', 'Linux computer', 'Laptop', 'Desktop computer', 'Smart TV', 'Streaming device', 'Game console', 'Printer', 'Camera', 'Smartwatch', 'VoIP phone', 'IoT device', 'Router / CPE', 'Other'];
function deviceTypeHint(hostname) {
    const name = String(hostname || '');
    for (const [pattern, label] of [[/iphone/i, 'iPhone'], [/ipad/i, 'iPad'], [/android|samsung|galaxy|pixel|redmi/i, 'Android device'], [/macbook|imac/i, 'Mac computer'], [/^desktop-|^laptop-|windows/i, 'Windows computer']]) {
        if (pattern.test(name)) return `Possible ${label} (hostname hint)`;
    }
    return null;
}

async function customerConnections(router, username, savedAccessPoints = []) {
    const warnings = [];
    let reading = 0;
    const waiting = [];
    async function read(command, properties, query = []) {
        if (reading >= 3) await new Promise(resolve => waiting.push(resolve));
        reading++;
        try { return await router(command, [`=.proplist=${properties}`, ...query]); }
        catch (error) {
            if (error?.errno === 'UNKNOWNREPLY' && /!empty/.test(error.message || '')) return [];
            warnings.push(`${command}: ${error.message}`);
            return null;
        }
        finally { reading--; waiting.shift()?.(); }
    }
    const active = await read('/ip/hotspot/active/print', 'user,address,mac-address,server,uptime,idle-time,session-time-left,login-by,bytes-in,bytes-out,radius', [`?user=${username}`, '=stats=']);
    if (active === null) return { connected: null, sessions: [], warnings, accessPoints: savedAccessPoints.map(ap => ({ ...ap, source: 'manager' })) };
    const sessions = (active || []).filter(row => row.user === username);
    const [identity, resource, wifiInterfaces, wirelessInterfaces, capInterfaces, capRadios, remoteCaps, wifiRadios, wifiCaps] = await Promise.all([
        read('/system/identity/print', 'name'), read('/system/resource/print', 'board-name'),
        read('/interface/wifi/print', 'name,radio-mac,master-interface,configuration.ssid,configuration.mode,disabled'),
        read('/interface/wireless/print', 'name,mac-address,ssid,mode,disabled'),
        read('/caps-man/interface/print', 'name,radio-mac,master-interface'),
        read('/caps-man/radio/print', 'interface,radio-mac,remote-cap-name,remote-ap-ident,local'),
        read('/caps-man/remote-cap/print', '.id,identity,name,common-name,address,board-name'),
        read('/interface/wifi/radio/print', 'interface,radio-mac,remote-cap-name,cap,local'),
        read('/interface/wifi/capsman/remote-cap/print', '.id,identity,common-name,address,board-name')
    ]);
    const accessPoints = [];
    for (const [kind, interfaces] of [['wifi', wifiInterfaces], ['wireless', wirelessInterfaces], ['capsman', capInterfaces]]) {
        for (const entry of interfaces || []) {
            const mode = entry.mode || entry['configuration.mode'];
            if (mode && !/^(?:ap(?:-|$)|bridge$)/.test(mode)) continue;
            const master = entry['master-interface'] && entry['master-interface'] !== 'none' ? entry['master-interface'] : entry.name;
            const radio = (kind === 'wifi' ? wifiRadios || [] : capRadios || []).find(row => row.interface === master);
            const capName = radio?.['remote-cap-name'] || radio?.['remote-ap-ident'] || radio?.cap;
            const cap = capName && (kind === 'wifi' ? wifiCaps || [] : remoteCaps || []).find(row => [row['.id'], row.name, row['common-name'], row.identity, `${row.identity}@${row.address}`].includes(capName));
            const local = kind === 'wireless' || radio?.local === true || radio?.local === 'true';
            const saved = savedAccessPoints.find(row => row.interface === entry.name);
            accessPoints.push({ name: saved?.name || cap?.identity || capName || (local ? identity?.[0]?.name : null) || entry.name,
                interface: entry.name, model: saved?.model || cap?.['board-name'] || (local ? resource?.[0]?.['board-name'] : null),
                address: saved?.address || cap?.address || null, radioMac: radio?.['radio-mac'] || entry['radio-mac'] || entry['mac-address'] || null,
                ssid: entry.ssid || entry['configuration.ssid'] || null, source: saved ? 'manager + router' : kind });
        }
    }
    for (const saved of savedAccessPoints) if (!accessPoints.some(row => saved.interface && row.interface === saved.interface)) accessPoints.push({ ...saved, source: 'manager' });
    if (!sessions.length) return { connected: active === null ? null : false, sessions: [], warnings, accessPoints };
    const [leases, hosts, wifi, wireless, capsman, wifiwave2] = await Promise.all([
        read('/ip/dhcp-server/lease/print', 'address,active-address,mac-address,active-mac-address,host-name,status,server,expires-after'),
        read('/interface/bridge/host/print', 'mac-address,on-interface,bridge'),
        read('/interface/wifi/registration-table/print', 'mac-address,interface,ssid,signal,uptime,tx-rate,rx-rate,band'),
        read('/interface/wireless/registration-table/print', 'mac-address,interface,signal-strength,uptime,tx-rate,rx-rate'),
        read('/caps-man/registration-table/print', 'mac-address,interface,ssid,rx-signal,uptime,tx-rate,rx-rate'),
        read('/interface/wifiwave2/registration-table/print', 'mac-address,interface,ssid,signal,uptime,tx-rate,rx-rate')
    ]);
    const registrations = [wifi, wireless, capsman, wifiwave2].flatMap(rows => rows || []);
    for (const registration of registrations) {
        if (registration.interface && !accessPoints.some(ap => ap.interface === registration.interface)) {
            accessPoints.push({ name: registration.interface, interface: registration.interface, ssid: registration.ssid || null, source: 'wireless registration' });
        }
    }
    return { connected: true, warnings, sessions: sessions.map(session => {
        const clientMac = mac(session['mac-address']);
        const matches = row => clientMac && mac(row['active-mac-address'] || row['mac-address']) === clientMac;
        const lease = (leases || []).find(row => matches(row) && (row['active-address'] || row.address) === session.address);
        const registration = registrations.find(matches);
        const ap = registration && accessPoints.find(row => row.interface === registration.interface);
        const host = (hosts || []).find(matches);
        return {
            ...fields(session, ['address','mac-address','server','uptime','idle-time','session-time-left','login-by','bytes-in','bytes-out','radius']),
            deviceName: lease?.['host-name'] || null,
            deviceType: deviceTypeHint(lease?.['host-name']),
            deviceTypeNote: 'Device type hints come from the device-supplied hostname. The router does not verify the type or exact model.',
            accessPoint: ap?.name || registration?.interface || null,
            accessPointDetails: ap || null,
            accessPointNote: registration ? 'Matched the device MAC address in the wireless registration table.' : 'Access point not reported by this router. An external AP may need its own controller connection.',
            wireless: registration ? fields(registration, ['interface','ssid','signal','signal-strength','rx-signal','uptime','tx-rate','rx-rate','band']) : null,
            bridgePort: host?.['on-interface'] || null,
            dhcp: lease ? fields(lease, ['host-name','status','server','expires-after']) : null
        };
    }), accessPoints };
}

function installCustomerDetails(app, { requireAdmin, read, save, router }) {
    app.get('/api/admin/vouchers/:id/details', requireAdmin, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const data = read();
        const voucher = data.vouchers.find(row => row.id === req.params.id);
        if (!voucher) return res.status(404).json({ message: 'Voucher no longer exists.' });
        try {
            const connections = await customerConnections(router, voucher.username, data.operations?.accessPoints || []);
            const current = read().vouchers.find(row => row.id === voucher.id);
            if (!current) return res.status(404).json({ message: 'Voucher no longer exists.' });
            const savedDevices = current.connectionDevices || [];
            for (const session of connections.sessions) {
                const saved = savedDevices.find(row => mac(row.macAddress) === mac(session['mac-address']));
                if (!saved) continue;
                session.savedDevice = saved;
                if (saved.deviceType) { session.deviceType = saved.deviceType; session.deviceTypeNote = 'Device type recorded by the manager.'; }
                session.deviceModel = saved.deviceModel || null;
                if (!session.accessPoint && saved.accessPoint) { session.accessPoint = saved.accessPoint; session.accessPointNote = 'Access point recorded by the manager. The router has not verified the current AP.'; }
            }
            res.json({ success: true, checkedAt: Date.now(), connections,
                savedDevices, deviceTypes: DEVICE_TYPES,
                customer: fields(current, ['id','username','phone','planId','amount','dataLimit','dataConsumedBytes','dataUsageUpdatedAt','createdAt','activatedAt','expiresAt','status','suspended','provisioning','source','paymentReference','lastTownId']),
                plan: data.plans.find(plan => plan.id === voucher.planId)?.name || voucher.planName || 'Custom' });
        } catch (error) { res.status(500).json({ message: error.message }); }
    });
    app.put('/api/admin/vouchers/:id/details', requireAdmin, (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const data = read(), voucher = data.vouchers.find(row => row.id === req.params.id);
            if (!voucher) return res.status(404).json({ message: 'Voucher no longer exists.' });
            const text = (name, limit = 100) => {
                const value = req.body?.[name] ?? '';
                if (typeof value !== 'string' || value.trim().length > limit) throw Error(`Invalid ${name}.`);
                return value.trim();
            };
            if (req.body?.action === 'access-point') {
                const name = text('name'), iface = text('interface'), address = text('address'), model = text('model');
                if (!name) throw Error('Enter an access point name.');
                data.operations ||= { expenses: [], audit: [], requests: [] };
                const aps = data.operations.accessPoints ||= [];
                const existing = aps.find(row => (iface && row.interface === iface) || row.name === name);
                if (!existing && aps.length >= 500) throw Error('This town already has 500 access points.');
                const ap = { name, interface: iface, address, model };
                if (existing) Object.assign(existing, ap); else aps.push(ap);
            } else if (req.body?.action === 'device') {
                const macAddress = mac(text('macAddress'));
                if (!/^[A-F0-9]{12}$/.test(macAddress)) throw Error('Enter a valid device MAC address.');
                const deviceType = text('deviceType'), deviceModel = text('deviceModel'), accessPoint = text('accessPoint');
                if (deviceType && !DEVICE_TYPES.includes(deviceType)) throw Error('Choose a device type from the list.');
                const devices = voucher.connectionDevices ||= [];
                const existing = devices.find(row => mac(row.macAddress) === macAddress);
                if (!existing && devices.length >= 100) throw Error('This voucher already has 100 saved devices.');
                const device = { macAddress, deviceType, deviceModel, accessPoint, updatedAt: Date.now() };
                if (existing) Object.assign(existing, device); else devices.push(device);
            } else throw Error('Choose an access point or device update.');
            save(data);
            res.json({ success: true });
        } catch (error) { res.status(400).json({ message: error.message }); }
    });
}
module.exports = { installCustomerDetails, customerConnections };

require('dotenv').config({ override: true });

const net = require('net');
const { RouterOSAPI } = require('routeros-client');

const vpsPublicKey = process.argv[2];
const vpsEndpoint = process.argv[3] || '104.248.239.23:51820';

if (!vpsPublicKey) {
    throw new Error('Usage: node configure-wireguard.js <vps-public-key> [vps-endpoint]');
}

const api = new RouterOSAPI({
    host: process.env.MIKROTIK_HOST || '192.168.10.1',
    user: process.env.MIKROTIK_USERNAME,
    password: process.env.MIKROTIK_PASSWORD,
    port: Number(process.env.MIKROTIK_PORT || 8728),
    timeout: Number(process.env.MIKROTIK_REQUEST_TIMEOUT_MS || 10000) / 1000
});

function checkApiPort(host, port) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port });

        socket.setTimeout(3000);
        socket.once('connect', () => {
            socket.destroy();
            resolve();
        });
        socket.once('timeout', () => {
            socket.destroy();
            reject(new Error(`Cannot reach MikroTik API at ${host}:${port}. Connect Ethernet 3 to VLAN 10 and retry.`));
        });
        socket.once('error', (error) => {
            reject(new Error(`Cannot reach MikroTik API at ${host}:${port}: ${error.code || error.message}`));
        });
    });
}

async function findOne(command, field, value) {
    let rows;

    try {
        rows = await api.write(command);
    } catch (error) {
        if (/!empty|UNKNOWNREPLY/.test(`${error.errno || ''} ${error.message || ''}`)) {
            return undefined;
        }

        throw error;
    }

    return rows.find((row) => row[field] === value);
}

async function listOrEmpty(command) {
    try {
        return await api.write(command);
    } catch (error) {
        if (/!empty|UNKNOWNREPLY/.test(`${error.errno || ''} ${error.message || ''}`)) {
            return [];
        }

        throw error;
    }
}

async function main() {
    try {
        await checkApiPort(
            process.env.MIKROTIK_HOST || '192.168.10.1',
            Number(process.env.MIKROTIK_PORT || 8728)
        );
        await api.connect();

        try {
            await api.write('/interface/wireguard/add', [
                '=name=wg-vps',
                '=listen-port=51820',
                '=mtu=1420'
            ]);
            console.log('Created MikroTik WireGuard interface: wg-vps');
        } catch (error) {
            if (!/already have|already exists|duplicate/i.test(error.message || '')) {
                throw error;
            }
        }

        const interfaceRow = await findOne('/interface/wireguard/print', 'name', 'wg-vps');
        if (!interfaceRow) {
            throw new Error('MikroTik WireGuard interface wg-vps was not found after creation.');
        }

        console.log('MikroTik WireGuard public key:', interfaceRow['public-key']);

        const addresses = await listOrEmpty('/ip/address/print');
        if (!addresses.some((row) => row.address === '10.200.0.2/24' && row.interface === 'wg-vps')) {
            await api.write('/ip/address/add', [
                '=address=10.200.0.2/24',
                '=interface=wg-vps',
                '=comment=EA-Soft WireGuard VPS'
            ]);
        }

        const peerParams = [
            '=interface=wg-vps',
            `=public-key=${vpsPublicKey}`,
            '=allowed-address=10.200.0.1/32',
            `=endpoint-address=${vpsEndpoint.split(':')[0]}`,
            `=endpoint-port=${vpsEndpoint.split(':')[1] || '51820'}`,
            '=persistent-keepalive=25s',
            '=comment=EA-Soft VPS'
        ];

        try {
            await api.write('/interface/wireguard/peers/add', peerParams);
            console.log('Added VPS WireGuard peer.');
        } catch (error) {
            if (!/already have|already exists|duplicate/i.test(error.message || '')) {
                throw error;
            }
            console.log('VPS WireGuard peer already exists.');
        }

        console.log('MikroTik WireGuard configured: 10.200.0.2/24 -> ' + vpsEndpoint);
        await api.close();
    } catch (error) {
        console.error('WireGuard configuration failed:', error.message || error);
        try {
            await api.close();
        } catch {}
        process.exitCode = 1;
    }
}

main();

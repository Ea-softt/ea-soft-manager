# Management VLAN network monitor

Open **Network monitor** and select a town. The backend asks that town's MikroTik
to ping all addresses from 192.168.10.1 to 192.168.10.254. ARP, DHCP leases and
neighbor discovery provide available MAC addresses and names. Static and DHCP
addresses are supported. New responding addresses appear under Other. Previously
discovered devices stay in the inventory when they stop replying.

Use **Add or label a device** to assign the actual management IP to Main or
Substations 1–3 and name it CPE610, CPE510, CPE210 TX/RX, EAP110, or another model.
The expected models shown beside each station are a guide; the monitor cannot
infer their IPs or station from the example layout. Add unreachable old devices
manually if they have never been discovered. Unused IPs are scanned but do not
create inventory entries. Devices outside this /24 are outside the scan.

Scans start while the monitor is open, one minute after the previous check finishes,
with six concurrent checks. Refresh retrieves progress during a scan. Previous
results stay visible during the next scan, with a check timestamp for each device.
The scan stops launching new checks after two minutes; unchecked devices retain
their earlier result and timestamp. API failures
show Unknown; lack of an ICMP reply shows No reply. This is a reachability check,
and devices blocking ICMP may still be operational. Internet reachability is
checked by pinging 1.1.1.1 and 8.8.8.8 from the router. Either responding target
establishes Online. If both complete without replies, the status is No reply.
If neither replies and a command fails, the status stays Unknown with its exact
error directly beneath Internet. These ICMP checks measure public reachability;
they do not verify DNS, web access, or customer hotspot access.
**Check Internet** runs these probes separately without launching a subnet scan.
Concurrent Internet checks share one pair of probes. A later inventory error
does not erase a completed Internet result. Hotspot users are the active sessions.

Set `NETWORK_WAN_INTERFACE=ether1` (replace ether1 with the actual Internet-facing
interface, such as your PPPoE interface) in the backend environment for download
and upload readings. If unset, a single member of the router's WAN interface list
is used, falling back to a uniquely resolved active default-route interface.
Ambiguous routes require explicit selection. Download is receive
traffic, upload is transmit traffic; rates are Mbps from a single router sample.
These are interface rates, not a speed test. Each custom town can override the
setting in its `router` configuration in towns.json.

The router account needs permission to read resources, ARP, DHCP, neighbors,
interface lists, interface traffic and hotspot sessions, and to ping. The router
must be able to reach VLAN 10 devices. Ping specifically requires the `test`
policy in the router API user's group. If the router rejects ping permissions,
the monitor reports the reason immediately and skips the subnet ping sweep.
Check **System → Users → Groups** in WinBox and enable `test` for the appropriate
API user group while preserving its existing policies. No TP-Link credentials
are needed.

Deploy `network-monitor.js` with the updated `server.js` and rebuild the Manager.
The packaging scripts include these files. Each town's persistent inventory is
stored beside its manager data as `<manager-file-basename>-network.json`. Keep
this file on persistent storage and back it up with your data directory. An
optional `NETWORK_INVENTORY_FILE` overrides its path and must be unique per town.
This inventory is separate from dashboard voucher JSON exports. Tracking is by
IP address: relabel devices after address reassignment. Restarting retains the
inventory but resets reachability to Unknown until the next check.

RouterOS references: [Ping](https://help.mikrotik.com/docs/spaces/ROS/pages/8323183/Ping)
and [interface traffic](https://help.mikrotik.com/docs/spaces/ROS/pages/139526175/Interface%20stats%20and%20monitor-traffic).

Verify with `node scripts/test-network-monitor.cjs` and `npm run build`.

# One voucher, every town

Shared mode uses FreeRADIUS 3.2 on the backend host for MikroTik HotSpot
authentication. All towns look up the same original voucher record. The first
successful authentication stores `activatedAt` and `expiresAt` once; later
logins receive only the remaining time and the same absolute termination time.
Failed passwords do not start the voucher. Accounting from every town reduces
one shared data allowance. Sales stay in the selling town's ledger.

This repository contains the backend integration and FreeRADIUS templates.
It does **not** automatically install FreeRADIUS or change live routers.
Local-router mode remains the default until the migration below is completed.

## Server preparation

1. Back up every town's JSON ledger, router configuration, and admin account.
   Deploy `server.js`, `towns.js`, `shared-vouchers.js`, `admin-auth.js`, and
   `terminal.js` with the existing package files. Configure `data/towns.json`
   using [MULTI-TOWN.md](MULTI-TOWN.md).
2. Run exactly **one backend process**, including with PM2: use fork mode with
   one instance. The JSON ledger serializes updates within that process; do not
   use clustered workers or multiple backends against these files.
3. Review existing vouchers before cutover. Codes must be unique across all
   towns, and every voucher needs a valid duration and data allowance. Preserve
   existing activation, expiry, and consumed-byte values. Duplicate codes block
   shared-mode startup; do not silently merge different purchases or restart
   their expiry. Resolve duplicates with replacement credentials first.
4. Install FreeRADIUS 3.2 and its REST module on the Linux backend host. For
   Debian/Ubuntu packages these are `freeradius` and `freeradius-rest`.
   Configure the backend's private environment:

   ```dotenv
   VOUCHER_AUTH_MODE=radius
   RADIUS_REST_SECRET=<at-least-32-random-characters>
   ```

   Set `EA_RADIUS_REST_SECRET` to the same value in the FreeRADIUS service's
   environment. Restart both services after setting their environments.
   This REST secret is separate from each router's RADIUS shared secret.
5. Install `radius/ea-rest.conf` as `mods-available/ea_rest` and
   `radius/ea-hotspot.conf` as `sites-available/ea_hotspot` in the FreeRADIUS
   configuration directory (usually `/etc/freeradius/3.0`). Enable both with
   symlinks in `mods-enabled` and `sites-enabled`. Keep `pap` and `chap` enabled.
   Remove the competing default listener from `sites-enabled` on a dedicated
   HotSpot RADIUS installation. Do not disrupt an existing RADIUS deployment;
   use a separate listener/address there instead.
6. Add a client entry per router using `radius/clients.example.conf`. Its
   `shortname` must exactly match the town ID, and its address must be that
   router's VPN source address. Give each router a separate random shared secret.
   Permit UDP 1812/1813 only from those private addresses. Require
   Message-Authenticator on compatible current RouterOS/FreeRADIUS versions.
7. The REST module connects to `127.0.0.1:3000`; adjust it if the backend uses a
   different local port. Exclude `/api/internal/` from the public reverse proxy
   and block public access to the backend port. The REST routes also require
   the shared secret and never use the browser's admin session token.
8. With the service environment loaded, run `freeradius -XC` to check the exact
   installed module/dictionary configuration. Then test PAP and CHAP on a pilot
   router before migrating customers. No FreeRADIUS runtime is installed in the
   Windows development workspace, so these templates require this Linux check.

## MikroTik changes in each town

Use the same central RADIUS server with that router's own client secret.
Example RouterOS commands, after replacing the address, secret, and profile:

```routeros
/radius add service=hotspot address=10.20.0.10 secret="REPLACE_ROUTER_SECRET" authentication-port=1812 accounting-port=1813
/ip hotspot profile set [find name="YOUR_HOTSPOT_PROFILE"] use-radius=yes radius-accounting=yes radius-interim-update=received login-by=http-chap
```

Keep server/router clocks synchronized with NTP. Each accepted session receives
`Session-Timeout` and `WISPr-Session-Terminate-Time`, so expiry is enforced by the
router even if the backend later becomes unreachable. New logins fail closed
when the shared service is unreachable. Keep the normal router rate/firewall
policy in its default HotSpot user profile; the response supplies each voucher's
rate limit and remaining byte allowance.

During a coordinated cutover, disconnect existing local voucher sessions and
remove the **managed local voucher entries** from every router after backup.
MikroTik checks local users before RADIUS: leaving matching local credentials
would bypass shared expiry and quota. Do not delete router administrator users.
Do not enable local trial, cookie, or MAC-cookie bypasses for managed vouchers.
The backend stops creating local voucher copies in shared mode. Leave each
town's portal API URL pointing at its own selling town, as in MULTI-TOWN.md.

## Data allowance and simultaneous use

Accounting uses cumulative upload plus download counters, including gigawords.
Duplicate and older packets cannot add usage twice or reduce usage. Before each
session is accepted, the backend reserves part of the remaining bytes and sends
that limit to the router. Reservations are persisted with the voucher, so a
backend restart cannot reset them or allocate the same bytes twice.

The plan's `sharedUsers` limit applies across all towns. With one permitted user,
log out of the first town before logging into another; the router's final Stop
record releases the session. With multiple users, remaining bytes are divided
among available slots. Reaching one session's allocated limit may require a new
login after final accounting, even if another slot has unused bytes.

Lost Stop accounting deliberately keeps the slot and its reserved bytes held;
it never assumes missing reports mean free data. Fix accounting delivery and
replay the final record with its original session ID and Class token. Do not
clear reservations merely because the last heartbeat is old. An expiry or
manual revocation still blocks new logins everywhere. Manual deletion tries to
disconnect active sessions in every town; if a router is unreachable, the
voucher remains revoked and deletion reports that it needs retrying.

Plan edits apply to newly sold vouchers. Existing vouchers retain their sold
duration, data allowance, rate, and simultaneous-user limit. Older vouchers
without stored rate/shared-user fields use their original town's plan settings.
Voucher and sales records remain under the selling town in the Manager; roaming
changes neither ownership nor reported revenue.

## Verification

Local: `node scripts/test-shared-vouchers.cjs`, `node scripts/test-towns.cjs`,
`node scripts/test-hotspot-payments.cjs`, `node scripts/test-activation.cjs`,
`node scripts/test-finances.cjs`, and `node scripts/test-admin-auth.cjs`.

On the pilot network, test wrong-password rejection without activation; buy in
town A and log in at town B; log out and move back with less time/data remaining;
try simultaneous sessions; restart the backend; verify expiry disconnects on
both routers even with the backend stopped; and verify local users cannot bypass
RADIUS. Check accounting Start, Interim, Stop, Class, and Acct-Session-Id in a
private diagnostic session. Do not publish debug logs containing credentials.

References: [MikroTik RADIUS attributes and local-user precedence](https://manual.mikrotik.com/docs/authentication-authorization-accounting/radius/),
[FreeRADIUS REST module](https://github.com/FreeRADIUS/freeradius-server/blob/v3.2.x/raddb/mods-available/rest),
[FreeRADIUS response controls](https://github.com/FreeRADIUS/freeradius-server/blob/v3.2.x/raddb/policy.d/control).

# Manage Wi-Fi in multiple towns

One backend and one admin login manage the MikroTik router in each town.
With shared RADIUS enabled, **a voucher works in every town, with one expiry
time and one total data allowance**. Moving towns never restarts its time or
data balance. A 5 GB voucher provides 5 GB across the entire network.

The Manager's **Town** selector groups voucher records and sales by the town
that sold them, and selects that town's router for Terminal. **All towns** shows
combined revenue without counting roaming as another sale. Enable shared login
using [the shared-voucher deployment guide](SHARED-VOUCHERS.md). Until that
server/router migration is complete, existing local-router mode still applies.

## Deploy the backend first

After deploying the backend and updated app, open **Settings → Towns & MikroTik
routers → Add town**. Enter the town name, router VPN/private address, API port,
username, and password. Optional SSH port and trusted fingerprint enable Terminal.
The town becomes available immediately without a backend restart. Passwords are
stored in the private server configuration and are not returned to the app.
Saving connection details does not test connectivity or configure the VPN,
router profiles, or RADIUS client; complete those steps before selling vouchers.

1. Back up `data/manager.json` and `data/admin-account.json` on the server.
2. Deploy `server.js`, `towns.js`, `terminal.js`, and `admin-auth.js` together,
   with `shared-vouchers.js` and the existing backend package files. Run `npm ci`
   in the backend folder. RADIUS setup is described in the linked guide.
3. The Settings form creates the server's private `data/towns.json` when you add
   the first additional town. The original router remains `default`. For manual
   configuration, use `towns.example.json` as a guide and restart after editing
   the file. An alternative existing file can be set using `TOWNS_FILE`.
4. Install the rebuilt desktop app. Android and web use the same frontend changes,
   but need their own rebuild and deployment.

Keep the `default` entry: it uses the current `.env` MikroTik settings and existing
`data/manager.json`, so old records and payments stay in place. Change its display
name to your first town. Do not change town IDs after they have been used; IDs are
recorded on payments. New towns start with the standard plans and empty records.
Configure prices in **Plans & pricing** before selling. Shared RADIUS applies
the sold voucher's duration, data allowance, and rate at any router.

The private configuration contains router passwords. Keep it on the server,
outside any public web directory. Router credentials are never sent to the app.
Each router must be reachable from the backend over its own private/VPN address.
For terminal access, configure that router's trusted SSH fingerprint as 64 hex
characters. API vouchers work independently of SSH terminal configuration.

New town records are stored beside the original manager file under
`towns/<town-id>.json`. Include this entire directory and `data/towns.json` in
private backups. Voucher ownership stays with its selling town; shared RADIUS
looks up that original record from every router, without copying credentials
or creating additional sales. Resolve existing duplicate usernames before
shared mode can start.

## Point each hotspot portal at its own town

In that town's MikroTik `login.html`, set the existing `PAYSTACK_BACKEND_URL`:

```javascript
var PAYSTACK_BACKEND_URL = 'https://YOUR-BACKEND/api/towns/second-town';
```

Use the matching town ID for each router. Upload the configured portal to that
router. The first town's existing `/api` URL remains supported; it can also use
`/api/towns/default`. The backend writes the selling town ID into new Paystack
payments and validates it before recording sales or issuing a voucher. Legacy
payments without a town ID belong to `default`. Recover a payment with its town
selected in the Manager.

Keep a single Paystack webhook URL: `https://YOUR-BACKEND/api/paystack/webhook`.
The backend checks the signature and verified transaction before fulfillment;
callbacks are dispatched to the selling town. Shared RADIUS reads each voucher's
original expiry and remaining allowance wherever the customer logs in.

## Local verification

Run `node scripts/test-towns.cjs` and `node scripts/test-admin-auth.cjs`, then
`npm run desktop:smoke` and `npm run desktop:build`. Integration checks simulate
two routers and Paystack; live router connectivity must be checked after the
private server configuration is deployed.

Routing uses [Express mounted middleware](https://expressjs.com/en/guide/using-middleware/).

# Data consumption

The manager's **Data consumption** menu shows upload + download totals for today,
this week, this month and this year, with daily (7 days), weekly (8 weeks),
monthly (12 months) and yearly (5 years) breakdowns. The town selector supports
individual towns and combined totals. Periods use UTC; weeks start on Monday.

Deploy the updated `server.js` and `towns.js`, restart the backend, and deploy
the manager built with `npm run build`. No RADIUS configuration change is needed.

## If the manager says “Data consumption unavailable”

The app has not received `dataUsage` from the backend. Updating the manager alone
does not update the API server. Upload the updated `hotspot/server.js` and
`hotspot/towns.js` to the existing `/var/www/ea-soft-api/` directory on the server,
then run these commands in the server's SSH terminal:

```sh
cd /var/www/ea-soft-api
node --check server.js
node --check towns.js
pm2 restart ea-soft-api --update-env
curl -fsS http://127.0.0.1:3000/api/health
```

Use the backend's configured port if it differs from 3000. The health response
must show `"version":"data-consumption-2026-09-27"`. You can also check the public
`/api/health` URL. Keep the existing `.env`, town configuration, and data files.
Refresh the manager afterward. If one town loads but **All towns** does not,
check `pm2 logs ea-soft-api --lines 40 --nostream` and the unavailable town's
data file permissions and JSON validity. Missing history starts empty;
an unreadable town must be repaired before combined totals are available.

Usage history is stored in each town's existing manager JSON file under
`dataUsage` and remains after vouchers are deleted. Keep those files in server
backups. The backend records RouterOS counter changes during its background
sync, even when the manager is closed. Shared vouchers use RADIUS accounting
changes; their usage belongs to the town that issued the voucher.

Old cumulative counters cannot be split into historical dates. The first
RouterOS reading establishes a baseline; subsequent increases are recorded.
Repeated RADIUS counters are not counted again. After a RouterOS counter reset,
the newly observed counter is recorded, but traffic missed before the reset
cannot be recovered. Consumption is assigned to the UTC date it is reported,
so delayed accounting and router outages can shift usage into a later day.
Periods before tracking began show “Not tracked”; the initial period is partial.

Validation: `node scripts/test-data-consumption.cjs`.

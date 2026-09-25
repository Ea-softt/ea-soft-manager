# Update an existing backend

The live server must run the new email/password routes before the Manager can sign in.
Updating the dashboard or uploading MikroTik's login.html does not update this server.

1. Back up the existing backend files and private configuration on the server.
2. Upload these files into the existing Node backend folder:
   - server.js
   - admin-auth.js
   - terminal.js
   - package.json
   - package-lock.json
3. Keep the server's existing .env and data directory. Add ADMIN_EMAIL and
   ADMIN_PASSWORD_HASH from the local hotspot/.env to the server environment privately.
   These two values configure the initial account. Do not replace the server's other
   environment settings with the local .env.
4. Run `npm install` inside that backend folder.
5. Restart the existing Node service using its current process manager (for example,
   PM2, systemd, or the hosting console). Do not start a second copy on the same port.
6. Check `/api/health`. Its version should be `recovered-activation-2026-09-23`.
7. An empty POST to `/api/admin/session` should return 401 (incorrect credentials),
   not 404. A 503 response means the initial account settings still need configuration.
8. Sign in using the configured email and password.

The account is stored in data/admin-account.json after first startup. Preserve this
file across updates so changed credentials are not lost. A restart signs out existing
Manager sessions. Password recovery additionally needs the SMTP settings in README.md.

The update archive deliberately excludes .env, account data, and payment/voucher data.

## If Nginx returns 502 Bad Gateway

After the Terminal update, missing `terminal.js` or the `ssh2` dependency can cause
older server.js versions to crash during startup. The latest server.js isolates
Terminal startup failures so login and payments remain available. Upload server.js,
terminal.js, package.json and package-lock.json together to `/var/www/ea-soft-api`,
preserving `.env` and `data`, then run:

```sh
cd /var/www/ea-soft-api
npm ci
pm2 restart ea-soft-api --update-env
pm2 logs ea-soft-api --lines 40 --nostream
curl -i http://127.0.0.1:3000/api/health
```

Use the backend's configured PORT if it is not 3000. Confirm the public
`http://104.248.239.23/api/health` also responds successfully. SSH settings are only
required for Terminal commands; they are not required for Manager sign-in.

The Node backend is unavailable to Nginx. Inspect the backend's startup log before
changing proxy or CORS settings. With PM2, run `pm2 list` followed by
`pm2 logs --lines 40 --nostream`. Check for missing files or modules, file permission
errors, an unsupported Node version, and the port used by the Nginx upstream.
The installed Nodemailer 10 dependency requires Node 20 or later for reset emails.
This update loads that optional dependency only when sending a reset email, so a
missing mail dependency does not stop sign-in or payment routes from starting.

## Permanent finance history

This version saves sales separately from vouchers in data/manager.json. Back up
that file before upgrading and preserve it during deployment. Existing vouchers
are migrated automatically. Activation, expiry, and single or bulk deletion do
not remove income or change its original reporting date. Explicit amount-paid
corrections still update income. Previously deleted records require a backup to
recover; the server cannot reconstruct those sales. Deploy the backend first,
then publish the updated Manager dashboard (or rebuild the Android app).

## Hotspot purchase recording

Upload server.js, admin-auth.js, terminal.js, package.json and package-lock.json into
/var/www/ea-soft-api, keeping .env and data intact. Run npm install and restart
`pm2 restart ea-soft-api --update-env`. Upload the updated login.html to the
MikroTik hotspot folder and deploy the updated Manager dashboard separately.

The portal resumes the transaction initialized by the backend. Configure Paystack's
webhook URL to your backend's /api/paystack/webhook endpoint, for example
http://104.248.239.23/api/paystack/webhook (use HTTPS when configured).
References initialized by this version are also persisted and checked periodically,
so a closed browser or missed webhook does not lose the purchase. Only Paystack-
verified successful GHS transactions with hotspot metadata create sales records.

Verified purchases are saved before router activation. If MikroTik is unavailable,
Manager displays the payment as activation pending and the server retries. Older
missing purchases can be recovered in Manager Settings using a Paystack reference.
Recovery verifies existing transactions; it does not charge the customer again.
References from older checkouts lacking hotspot metadata require manual investigation.
Keep one backend process active; use ea-soft-api, not a second copy of server.js.

Recovered vouchers retain known activation and expiry timestamps. Active-session sync
uses a saved duration or a known standard package when the Manager plan is missing.
Detected login times are saved even if scheduling expiry on MikroTik fails; scheduling
retries separately. When no historical login timestamp exists, the current session
uptime supplies an observed login time, not proof of the original first login.

## Recovery email on DigitalOcean

Upload the latest admin-auth.js. Add EMAIL_PROVIDER=sendgrid, EMAIL_FROM (a sender
verified in SendGrid), and SENDGRID_API_KEY (with Mail Send permission) to the private
server .env. Restart ea-soft-api with --update-env, then request a reset code in the
Manager. SendGrid uses HTTPS; standard SMTP ports are blocked on DigitalOcean.
Never replace your existing .env with a sample file. No app rebuild is needed.

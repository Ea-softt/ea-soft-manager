# Update an existing backend

The live server must run the new email/password routes before the Manager can sign in.
Updating the dashboard or uploading MikroTik's login.html does not update this server.

1. Back up the existing backend files and private configuration on the server.
2. Upload these files into the existing Node backend folder:
   - server.js
   - admin-auth.js
   - package.json
   - package-lock.json
3. Keep the server's existing .env and data directory. Add ADMIN_EMAIL and
   ADMIN_PASSWORD_HASH from the local hotspot/.env to the server environment privately.
   These two values configure the initial account. Do not replace the server's other
   environment settings with the local .env.
4. Run `npm install` inside that backend folder.
5. Restart the existing Node service using its current process manager (for example,
   PM2, systemd, or the hosting console). Do not start a second copy on the same port.
6. Check `/api/health`. Its version should be `email-password-admin-2026-09-22-startup-fix`.
7. An empty POST to `/api/admin/session` should return 401 (incorrect credentials),
   not 404. A 503 response means the initial account settings still need configuration.
8. Sign in using the configured email and password.

The account is stored in data/admin-account.json after first startup. Preserve this
file across updates so changed credentials are not lost. A restart signs out existing
Manager sessions. Password recovery additionally needs the SMTP settings in README.md.

The update archive deliberately excludes .env, account data, and payment/voucher data.

## If Nginx returns 502 Bad Gateway

The Node backend is unavailable to Nginx. Inspect the backend's startup log before
changing proxy or CORS settings. With PM2, run `pm2 list` followed by
`pm2 logs --lines 40 --nostream`. Check for missing files or modules, file permission
errors, an unsupported Node version, and the port used by the Nginx upstream.
The installed Nodemailer 10 dependency requires Node 20 or later for reset emails.
This update loads that optional dependency only when sending a reset email, so a
missing mail dependency does not stop sign-in or payment routes from starting.

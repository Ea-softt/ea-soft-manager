# EA-Soft Manager

Android-ready management dashboard for EA-Soft hotspot vouchers. This app is separate from the MikroTik hotspot files in `hotspot/`.

## Run

```powershell
npm install
npm run dev
```

## Android

The Android project is already included. Install JDK 21, Android Studio, and
Android SDK 35, then build an installable debug APK on Windows:

```powershell
npm install
npm run android:build
```

The APK is created at `android/app/build/outputs/apk/debug/app-debug.apk`.
Copy it to your phone, open it, and allow installation from that source when
Android prompts. This debug APK is for direct installation; Play Store
distribution requires a signed release build. Android 6.0 or newer is required.

Sign in with your admin email and password. Your email is also your username.
Settings lets you change your email and password after entering your current password.
Forgot password sends a one-time reset code to your account email; codes expire after
15 minutes. Password changes invalidate all sessions. Sign out using the top bar;
reloading the app requires sign-in again.

Deploy `hotspot/admin-auth.js` with `hotspot/server.js`, run `npm install` in `hotspot/`,
and restart the backend. The private local `hotspot/.env` has the supplied default
email and salted password hash configured as `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH`.
Copy those values privately to the deployed server environment. On first startup,
the backend saves the account in `hotspot/data/admin-account.json`; keep this file
on persistent storage and back it up privately. Future account changes use this file,
so restarting does not restore the default password. Do not commit it or serve it publicly.

For recovery email, configure `SMTP_HOST`, `SMTP_PORT` (587 or 465), `SMTP_USER`,
`SMTP_PASSWORD`, and `SMTP_FROM` in the backend environment. Gmail requires an app
password for SMTP. Recovery reports unavailable until email delivery is configured.
SMTP configuration details: https://nodemailer.com/smtp

The server URL is configured by the app, with no URL or token fields on the login
screen. The default Android/local-development URL is `http://104.248.239.23/api`;
web deployments use their own origin. Android permits
HTTP only for that existing backend address. Use HTTPS for other backend hosts.
API calls use native networking. CSV credentials and JSON backups open the
Android share sheet, where you can save or share the file. To edit the native
project, run `npm run android:open`. After web changes, rebuild with
`npm run android:build`.

The launcher icon source is `assets/icon.png`. To regenerate the Android icon
sizes after replacing that image, run `./scripts/generate-android-icons.ps1`
in PowerShell, then rebuild the APK.

The app requires backend authentication before accessing the dashboard. Sessions expire after eight hours and are held only in memory. Admin passwords are hashed on the server. Browser storage and exported backups exclude session credentials. Use HTTPS on the backend to protect sign-in credentials in transit.

## Online connection

Use one backend for both clients:

```text
Customer -> MikroTik hotspot/login.html -> /api payment backend -> Paystack
													|
													+-> MikroTik RouterOS API
													+-> manager data store
EA-Soft Manager app -------------------------------> /api/admin/state
```

In `hotspot/login.html`, set `PAYSTACK_BACKEND_URL` to the public backend API, for example `http://104.248.239.23/api`. The Manager uses its configured backend URL automatically. For production, expose the backend over HTTPS and use that HTTPS URL in both clients.

For the connected workflow, run the backend from `hotspot/` with `npm install` and `npm start`, configure the sanitized `hotspot/.env.example`, and point the hotspot portal's `PAYSTACK_BACKEND_URL` at the same HTTPS backend. Use WireGuard or another private network path from the DigitalOcean host to the MikroTik management address; do not expose RouterOS API port `8728` to the public internet.

## Finance history

Revenue and daily/weekly/monthly/yearly figures use permanent sales records in
`hotspot/data/manager.json`, separate from the voucher list. Voucher activation,
expiry, and deletion leave those records unchanged. Editing Amount paid explicitly
corrects the recorded amount. Existing voucher records migrate automatically on
backend reads; already-deleted records need a backup to recover. Keep manager.json
on persistent storage and back it up before deploying updates. Dashboard exports
include sales history; importing voucher lists does not overwrite backend finances.

Hotspot payments are recorded immediately after Paystack verification, before router
activation. Pending activations remain visible and retry automatically. The server
also checks saved checkout references if the browser closes or a webhook is missed.
In Settings, use Recover payment with an older Paystack reference to recover missing
purchases without charging again. Deploy the updated hotspot/login.html to MikroTik
as well as the backend and Manager dashboard. See hotspot/ADMIN-LOGIN-UPDATE.md.

## Android fingerprint sign-in

On an Android phone with an enrolled strong biometric, tick **Enable fingerprint
sign-in on this phone** on the login screen, then sign in with your email and
password. Approve Android's biometric prompt to save the login. On later launches,
choose **Sign in with fingerprint**. Compatible strong face biometrics may also be
accepted by Android's system prompt. Password login remains available.

Credentials are encrypted using a per-use biometric-protected Android Keystore key
and stored only in the app's no-backup directory. Unlocking still obtains a fresh
session from the backend; fingerprint authentication does not bypass server login.
The saved login is tied to the backend URL. Sign out retains the optional fingerprint
login; **Settings ? Disable fingerprint sign-in** removes it. Account changes on this
phone clear it. If the password changes elsewhere, sign in with the new password and
enable fingerprint again. New biometric enrollment or a reset screen lock may require
setup again. No backend deployment is needed for this feature.

Verification: `node scripts/test-biometric-login.cjs`, `node scripts/test-admin-auth.cjs`,
and `npm run android:build`. Physical biometric enrollment, cancellation, lockout,
reopening the app, and disabling the feature must also be checked on the phone.

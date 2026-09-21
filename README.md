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

Open Settings in the app and save the backend URL and manager token. Sync starts
automatically. The default URL is `http://104.248.239.23/api`; Android permits
HTTP only for that existing backend address. Use HTTPS for other backend hosts.
API calls use native networking. CSV credentials and JSON backups open the
Android share sheet, where you can save or share the file. To edit the native
project, run `npm run android:open`. After web changes, rebuild with
`npm run android:build`.

The launcher icon source is `assets/icon.png`. To regenerate the Android icon
sizes after replacing that image, run `./scripts/generate-android-icons.ps1`
in PowerShell, then rebuild the APK.

The app works offline with local records, or can connect through Settings to the protected manager API in `hotspot/server.js`. Set `ADMIN_API_TOKEN` on the backend, deploy the backend to an always-on HTTPS host such as a DigitalOcean Droplet, and enter the host URL plus token in the app. The backend keeps MikroTik, Paystack, SMS, and DigitalOcean credentials off the device.

## Online connection

Use one backend for both clients:

```text
Customer -> MikroTik hotspot/login.html -> /api payment backend -> Paystack
													|
													+-> MikroTik RouterOS API
													+-> manager data store
EA-Soft Manager app -------------------------------> /api/admin/state
```

In `hotspot/login.html`, set `PAYSTACK_BACKEND_URL` to the public backend API, for example `http://104.248.239.23/api`. In the manager Settings screen, use the same URL and enter the matching `ADMIN_API_TOKEN`; the manager accepts either the server URL or a URL ending in `/api`. For production, expose the backend over HTTPS and use that HTTPS URL in both clients.

For the connected workflow, run the backend from `hotspot/` with `npm install` and `npm start`, configure the sanitized `hotspot/.env.example`, and point the hotspot portal's `PAYSTACK_BACKEND_URL` at the same HTTPS backend. Use WireGuard or another private network path from the DigitalOcean host to the MikroTik management address; do not expose RouterOS API port `8728` to the public internet.

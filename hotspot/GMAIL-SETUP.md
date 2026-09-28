# Gmail password recovery

The backend supports `EMAIL_PROVIDER=gmail` for password reset emails through the Gmail HTTPS API. It uses the existing reset flow for managers and agents. No SMTP port, Gmail account password, App Password, frontend rebuild, or new npm dependency is needed. The selected sender account authorizes sending only; managers and agents do not need Google accounts to receive their reset emails.

## 1. Create Google credentials

Sign in to [Google Cloud Console](https://console.cloud.google.com/) using the Gmail account that will send email (for example, `botee2020@gmail.com`).

1. Create/select a project, such as **EA-Soft Recovery**.
2. In **APIs & Services → Library**, find **Gmail API** and enable it.
3. Open **Google Auth Platform** and complete **Branding** with your app name, support email and contact email.
4. Under **Audience**, choose **External** for a personal Gmail account. While testing, add the sender Gmail address as a test user.
5. Under **Data Access**, add only `https://www.googleapis.com/auth/gmail.send`.
6. Under **Clients → Create client**, choose **Desktop app**, name it **EA-Soft Gmail Setup**, and download its JSON credentials. This client is for the local setup helper, even though the resulting token is used by your server.
7. Save the downloaded file locally as `hotspot/.gmail-client.json`. This path is ignored by Git. Do not paste the JSON or any secrets into chat.

Google's [credential setup guide](https://developers.google.com/workspace/guides/create-credentials) and [Gmail quickstart](https://developers.google.com/workspace/gmail/api/quickstart/nodejs) describe the console screens.

## 2. Authorize on your Windows computer

In local PowerShell, from this project:

```powershell
cd C:\Users\User\Downloads\ea-soft-manager
node scripts/setup-gmail.cjs .\hotspot\.gmail-client.json botee2020@gmail.com
```

Open the link printed in the terminal in a browser on that same computer. Sign in with the specified sender account and grant permission to send email. The helper listens on localhost for five minutes, checks the callback state, and uses PKCE. It saves five private configuration values to `hotspot/.env.gmail`; it does not print tokens or send email. It will not overwrite an existing file. For reauthorization, choose a new output path:

```powershell
node scripts/setup-gmail.cjs .\hotspot\.gmail-client.json botee2020@gmail.com .\hotspot\.env.gmail.new
```

**Before relying on this for ongoing password recovery:** external OAuth apps in **Testing** receive refresh tokens that expire after seven days for the Gmail send scope. Review Google's requirements for moving the app to **In production**, including any applicable verification, then run authorization again to obtain a new token. Publishing is not the same as verification, and tokens can still be revoked. See [Google token-expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration) and [production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview). This setup does not bypass Google consent or verification requirements.

## 3. Configure the existing server

Upload the two backend modules from local PowerShell:

```powershell
scp .\hotspot\admin-auth.js .\hotspot\gmail-email.js root@104.248.239.23:/var/www/ea-soft-api/
```

Open `hotspot/.env.gmail` locally in your editor. On your server, edit `/var/www/ea-soft-api/.env` and add/update the five generated settings:

```dotenv
EMAIL_PROVIDER=gmail
EMAIL_FROM=botee2020@gmail.com
GMAIL_CLIENT_ID=generated-client-id
GMAIL_CLIENT_SECRET=generated-client-secret
GMAIL_REFRESH_TOKEN=generated-refresh-token
```

The values above are placeholders; use the helper's actual generated values. Keep all other existing `.env` settings and data files. The backend reads `.env`, not the helper's `.env.gmail` output file. `EMAIL_FROM` must be the Gmail account you authorized.

Then run on the server:

```bash
cd /var/www/ea-soft-api
node --check admin-auth.js
node --check gmail-email.js
pm2 restart ea-soft-api --update-env
```

Use **Forgot password** with an existing manager or agent account email. Check that recipient's inbox and spam folder. Gmail acceptance does not guarantee inbox delivery. If Google rejects authorization, check the project has Gmail API enabled, the correct sender authorized `gmail.send`, and the refresh token has not expired or been revoked. Reauthorize and update the server settings if necessary.

Implementation reference: [Gmail message sending](https://developers.google.com/workspace/gmail/api/guides/sending), [desktop OAuth and token refresh](https://developers.google.com/identity/protocols/oauth2/native-app).

Local tests use fake token and Gmail responses: `node scripts/test-gmail-email.cjs` and `node scripts/test-gmail-setup.cjs`. They do not contact Google or send email.

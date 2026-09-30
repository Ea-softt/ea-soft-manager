# Manager backup and restore

Open **Backup & restore** in the manager navigation. Agents cannot access these operations.

## Create a backup

Enter and confirm a password of at least 12 characters, then choose **Download full backup**. Save the JSON file and keep its password separately. The file uses authenticated AES-256-GCM encryption with a scrypt-derived key; a forgotten backup password cannot be recovered.

One file includes the owner account, registered managers and agents, and every configured town's plans, vouchers and credentials, sales, payment attempts, agent payments and reversals, deleted voucher IDs, data-consumption history, and report corrections. Account passwords remain stored as hashes inside the encrypted backup.

This is an application-record backup. It does not include `.env`, API keys, Gmail authorization files, town/router connection configuration, MikroTik device configuration, router-only changes, or preferences saved only on a particular device. Keep server configuration and router backups separately. The unencrypted record payload is limited to 20 MB. Older screen-only JSON exports are not compatible with this restore function.

## Restore

1. Choose the backup file and enter its backup password.
2. Select **Preview backup** and check the owner, towns, and record counts. Nothing changes during preview. Previews expire after ten minutes and are tied to the current login session.
3. Enter your current manager password and type `RESTORE`, then select **Restore all manager records**.

Restoring replaces all application records and account credentials; it does not merge them. The configured town IDs must exactly match the backup. The server automatically saves an encrypted copy of the current records using the backup password entered during preview.

Under PM2, the backend schedules a restart after acknowledging the restore. Outside PM2, restart the backend manually. Until restart, requests receive a maintenance response. Pending data is applied before accounts, routers, and background jobs load; an interrupted application is retried at the next startup. Everyone must sign in again using credentials from the restored backup. Voucher records are restored, but existing MikroTik device state is not rolled back or reprovisioned by this operation.

Use **Show safety backups** to download previous automatic copies after signing in again. Restore a safety copy using the same preview and confirmation steps. Safety copies are stored beside `DATA_FILE` in the `backups` directory and are retained until the administrator removes them. The temporary pending restore contains decrypted records, is written with owner-only permissions on Linux, and is removed after successful startup application.

## Updating an existing installation

Deploy `workspace-backup.js`, `towns.js`, `admin-auth.js`, and `server.js` together with the updated frontend build. The server-update packaging script includes the new module and this guide. Restart the backend after deployment. No additional npm dependencies are required.

If Nginx or another reverse proxy limits uploads, allow at least 32 MB for `/api/admin/backup/preview` (Nginx: `client_max_body_size 32m;`). The Express preview endpoint accepts up to 32 MB; other JSON endpoints retain their existing 1 MB limit.

Validation: `node scripts/test-workspace-backup.cjs` and `node scripts/test-backup-ui.cjs`.

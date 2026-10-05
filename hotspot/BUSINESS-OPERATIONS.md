# Business operations release

Select a town, then open **Business operations**. All operations require a manager account; agents cannot use these routes. Search by username or phone. Results show payment history, connection state, first login, expiry, usage timestamp and recent retained router events. Unknown router state is not presented as disconnected. Search returns at most 100 customers; narrow the search when needed.

## Activation and timezones

The existing active-session check runs every ten seconds. An additional check runs once per minute and on a stale Operations-page request. It reads router health and retained HotSpot logs. Automatic recovery requires a dated account-creation event within two minutes of the saved purchase and a subsequent successful login for the same username. Time-only logs, missing creation evidence and ambiguous DST timestamps are rejected. Unresolved used vouchers remain flagged for investigation. Existing activation/expiry values are never replaced by recovery.

Calendar expiry uses the router's named timezone, including DST, instead of UTC wall-clock values. Configure a named timezone and reliable NTP on every router. Manual timezone mode or ambiguous repeated DST hours keep scheduling pending; the backend expiry job remains responsible for retrying/enforcing expiry. The first successful sync refreshes existing future-dated expiry schedules with timezone-aware values; a per-voucher migration marker prevents repeated work.

## Voucher operations and payments

For router-local vouchers, managers can extend validity, add data, suspend, resume and replace a lost/compromised password while preserving the voucher's time and allowance. Password replacement removes existing sessions and login cookies; use Resend after the operation completes. Suspension does not pause time. Extensions add time after the later of current expiry or now. Unused vouchers still start on first login. These are support adjustments, not a new sale; record any separate payment through the normal voucher sales workflow. A reason is required. Absolute router updates are queued and retried after outages, with their state and last error shown. One pending update per voucher is allowed. Shared RADIUS lifecycle changes are not enabled by these controls; shared vouchers retain their existing authentication, accounting and expiry workflow.

Managers can reconcile a Paystack reference using the existing server-side transaction verification and fulfillment process. The list of outstanding references is not a list of proven successful payments. Credential resends go only to the saved phone number. Delivery uncertainty is retained and is not automatically retried; check the provider before sending again. SMS requires existing provider configuration and may incur provider charges.

## Expenses, profit and history

Record internet, electricity, equipment, commission and other expenses. Voiding requires a reason and retains the original entry. Profit is all-time reported sales less non-voided expenses; cleared report entries are excluded. This is a management report, not a tax/accounting ledger. Audit history records operations and successful existing town admin mutations without storing request bodies, passwords or API keys. Terminal commands and authentication/backup operations are not included in the town audit list. Keep server access restricted; audit history is not tamper-proof against a server administrator.

Expenses, operation queues and audits are included in encrypted full backups and restores. In-flight router operations use idempotent absolute updates; still verify router state after restoring an older backup, as backups do not restore router configuration.

## Customer portal

Serve over HTTPS: `/api/towns/default/public/customer-portal` (replace `default` with the selling town). Customers can check allowance/expiry using their voucher credentials, request a resend to the matching saved phone, or buy a new package through Paystack. Never expose the admin token to this page. Customer responses exclude phone numbers, passwords and payment references. Rate limits are held in memory per backend process; keep the existing single-process deployment. Behind a proxy, clients may share an IP-based limit. Credential recovery allows one request per IP and username per hour. SMS is optional; customers can contact support when it is not configured.

Hosted checkout creates a separate voucher and sends its credentials through the existing payment recovery/SMS flow. The customer must return to the hotspot login page; this portal does not automatically authenticate a phone on the router. Make the HTTPS backend and payment provider reachable through the router's walled garden. Link the portal from your website or login page after HTTPS is configured.

## Scheduled backups

Open **Backup & restore → Automatic encrypted backups**. Enable a frequency (1–168 hours), retention (1–90 copies), and an encryption password. The password is stored in an owner-only file on the server for unattended encryption and is never returned by the API. Keep a separate copy of it. Changes take effect on the next one-minute scheduler tick. Download scheduled copies using the existing saved-backup list. Old scheduled files are rotated only after a new encrypted file has been written. Before-restore safety copies are never rotated.

These are on-server backups. Download them off-server regularly; losing the entire server also loses local backups. Scheduling settings/passwords are not inside exported record backups. Failure is shown in schedule status and retried after an hour. Keep one backend process, as with payments and RADIUS.

## Deployment

Run `scripts/update-hotspot-server.ps1` from local PowerShell. It builds an allowlisted release, uploads to a unique staging directory, backs up existing backend files privately, stops PM2 for installation, installs production dependencies and restarts. Failed installation triggers code rollback. `.env`, `data`, and scheduler settings are never overwritten by the release. This updates the backend only; publish the newly built `dist` separately through your existing frontend hosting workflow. Router `login.html` is a separate upload too.

The release must include `business-operations.js`, `router-time.js`, `customer.html`, and `workspace-backup.js` alongside the existing backend modules. Do not upload only `server.js`. Check the Operations page and backup schedule after signing in again.

Tests: `node scripts/test-business-operations.cjs`, `node scripts/test-scheduled-backup.cjs`, existing activation/payment, towns, shared-voucher, finance, data-consumption, agent, backup and terminal suites, plus `npm run build`. Automated router tests use mocked API replies; production router behavior and SMS delivery require a post-deployment check.

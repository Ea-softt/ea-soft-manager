# Agent portal

Managers open **Agents & staff**, enter a name, email, initial password (at least 12 characters), and choose Agent or Manager. Each person uses their own credentials on the existing login page. Manager accounts have full management access. Agent accounts open the restricted voucher portal automatically. Existing owner credentials continue to work.

Agents choose a town, select an existing plan (including custom plans created by a manager), and enter the customer phone number. The server generates the three-digit username and password and uses the plan price. Agents cannot edit prices, credentials, plans, or other agents' records. Voucher expiry still starts at first login. SMS uses that town's existing provider configuration; the portal shows whether submission succeeded and displays the voucher if SMS fails. Submission is not a delivery receipt.

Each agent sees their voucher history and amount owed for the selected town. Managers see each agent's sales and record payments received in **Agents & staff**. Amount owed = recorded voucher sales minus payments received; no commission is deducted. Sales and attribution survive voucher deletion. Existing manager amount corrections also update the agent balance. Payment records include the receiving manager and timestamp.

Both pages show total sales payable to the manager, money already received, and the remaining balance separately. For GH₵7.50 sales with GH₵3.00 actually received, GH₵4.50 remains. Record only money actually received. If a payment was entered by mistake, the manager can expand **Correct a payment entered by mistake**, enter a reason, and reverse that payment record. The original receipt, reversal time, manager, and reason remain in history; reversed payments are excluded from received totals. To correct an amount, reverse the incorrect receipt and record the actual amount received. This records a correction; it does not transfer or refund money. If a sale correction reduces sales below money already received, the difference is shown as agent credit rather than a negative amount to pay.

## Updating an existing installation

Deploy the updated frontend build together with `server.js`, `towns.js`, `admin-auth.js`, and the new `agent-portal.js` backend module. Restart the backend. The packaging script includes the new module. Preserve `.env` and all existing data files. No router changes or new dependencies are required.

Additional accounts are stored as password hashes in a companion file named `<ADMIN_ACCOUNT_FILE>.staff.json` (normally `data/admin-account.json.staff.json`). Include it in private backups alongside the owner account and town data files. Agent sales and payment receipts are stored in each town's existing manager data file. Password recovery uses the existing configured email provider for both roles.

Run `node scripts/test-agent-portal.cjs` for account roles, access restrictions, automatic vouchers, SMS submission/failure, duplicate retries, payment accounting, town separation, and persistence checks.

const crypto = require('crypto');

function installAgentPortal(app, deps) {
    const { requireAdmin, readManagerData, saveManagerData, writeManagerData,
        generateVoucherUsername, generateVoucherPassword, profileNameForPlan, planDurationMs,
        createMikroTikUser, sendVoucherSms, sharedVouchers, getReservations } = deps;
    const requireSession = requireAdmin.requireSession || requireAdmin;
    const inFlight = new Map();
    const cents = (amount) => Math.round(Number(amount) * 100);
    function ledger(data, agentId) {
        const sales = data.sales.filter((sale) => sale.agentId && (!agentId || sale.agentId === agentId));
        const payments = (data.agentPayments || []).filter((payment) => !agentId || payment.agentId === agentId);
        const totalSales = sales.reduce((sum, sale) => sum + cents(sale.amount), 0);
        const totalReceived = payments.filter((payment) => !payment.voidedAt).reduce((sum, payment) => sum + cents(payment.amount), 0);
        return { sales, payments, totalSales: totalSales / 100, totalReceived: totalReceived / 100,
            amountDue: Math.max(0, totalSales - totalReceived) / 100,
            creditBalance: Math.max(0, totalReceived - totalSales) / 100 };
    }
    app.use('/api/agent', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    app.get('/api/agent/state', requireSession, (req, res) => {
        const data = readManagerData();
        res.json({ success: true, plans: data.plans, users: data.vouchers.filter((v) => v.agentId === req.staff.id), ...ledger(data, req.staff.id) });
    });
    app.get('/api/admin/agents', requireAdmin, (_req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, ...ledger(readManagerData()) });
    });
    app.post('/api/admin/agent-payments', requireAdmin, (req, res) => {
        const { agentId, requestId } = req.body || {};
        const amount = Number(req.body?.amount);
        if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId) || !Number.isFinite(amount) || cents(amount) <= 0 || Math.abs(amount * 100 - cents(amount)) > 0.00001) {
            return res.status(400).json({ message: 'Enter a positive payment with at most two decimal places and a request ID.' });
        }
        const data = readManagerData();
        data.agentPayments ||= [];
        const existing = data.agentPayments.find((p) => p.id === requestId);
        if (existing) {
            if (existing.agentId !== agentId || cents(existing.amount) !== cents(amount)) return res.status(409).json({ message: 'This request ID belongs to a different payment. Refresh and try again.' });
            return res.json({ success: true, payment: existing });
        }
        if (!agentId || !data.sales.some((s) => s.agentId === agentId) || cents(amount) > cents(ledger(data, agentId).amountDue)) return res.status(400).json({ message: 'Payment must not exceed this agent’s outstanding balance in this town.' });
        const payment = { id: requestId, agentId, amount: cents(amount) / 100, createdAt: Date.now(), receivedBy: req.staff.id };
        data.agentPayments.push(payment);
        saveManagerData(data);
        res.status(201).json({ success: true, payment });
    });
    app.post('/api/admin/agent-payments/:id/void', requireAdmin, (req, res) => {
        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
        if (!reason || reason.length > 300) return res.status(400).json({ message: 'Enter a correction reason of 1–300 characters.' });
        const data = readManagerData();
        const payment = (data.agentPayments || []).find((item) => item.id === req.params.id);
        if (!payment) return res.status(404).json({ message: 'Payment not found in this town.' });
        if (!payment.voidedAt) {
            payment.voidedAt = Date.now();
            payment.voidedBy = req.staff.id;
            payment.voidReason = reason;
            saveManagerData(data);
        }
        res.json({ success: true, payment });
    });
    app.post('/api/agent/vouchers', requireSession, async (req, res) => {
        const { planId, requestId } = req.body || {};
        const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
        if (!/^(?:0\d{9}|\+?[1-9]\d{9,14})$/.test(phone) || typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) return res.status(400).json({ message: 'Enter a valid customer phone number and request ID.' });
        const key = `${req.staff.id}:${requestId}`;
        async function create() {
            const data = readManagerData();
            const existing = data.vouchers.find((v) => v.agentId === req.staff.id && v.agentRequestId === requestId);
            if (existing) return existing;
            if (data.sales.some((s) => s.agentId === req.staff.id && s.agentRequestId === requestId)) throw new Error('This voucher was already created and subsequently deleted.');
            const plan = data.plans.find((p) => p.id === planId);
            if (!plan || !Number.isFinite(Number(plan.price)) || Number(plan.price) < 0 || !(Number(plan.dataLimit) > 0) || !(planDurationMs(plan) > 0)) throw new Error('Select a valid plan.');
            const username = generateVoucherUsername();
            const password = generateVoucherPassword();
            const reservations = getReservations();
            reservations.add(username);
            try {
                const profile = profileNameForPlan(plan);
                if (sharedVouchers) sharedVouchers.assertAvailable(username);
                else await createMikroTikUser(username, password, profile, Number(plan.dataLimit) * 1024 ** 3);
                const voucher = { id: crypto.randomUUID(), username, password, phone, planId: plan.id, planName: plan.name,
                    durationMs: planDurationMs(plan), sharedUsers: plan.sharedUsers || 1, rateLimit: plan.rateLimit || '',
                    amount: cents(plan.price) / 100, dataLimit: plan.dataLimit, createdAt: Date.now(), activatedAt: null, expiresAt: null,
                    status: 'active', source: 'agent', agentId: req.staff.id, agentName: req.staff.name || req.staff.email,
                    agentRequestId: requestId, smsStatus: 'pending' };
                data.vouchers.unshift(voucher);
                writeManagerData(data);
                // Persist the sale before contacting SMS so delivery failure never creates a second sale.
                let sms;
                try { sms = await sendVoucherSms(phone, username, password, profile); }
                catch { sms = { success: false }; }
                const latest = readManagerData();
                const stored = latest.vouchers.find((v) => v.id === voucher.id);
                voucher.smsStatus = sms?.success ? 'submitted' : 'failed';
                if (stored) { stored.smsStatus = voucher.smsStatus; saveManagerData(latest); }
                return voucher;
            } finally { reservations.delete(username); }
        }
        try {
            if (!inFlight.has(key)) inFlight.set(key, create());
            const user = await inFlight.get(key);
            res.status(201).json({ success: true, user, amountDue: ledger(readManagerData(), req.staff.id).amountDue });
        } catch (error) { res.status(400).json({ message: error.message || 'Voucher creation failed.' }); }
        finally { inFlight.delete(key); }
    });
}
module.exports = { installAgentPortal };

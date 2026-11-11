const crypto = require('node:crypto');
const AppError = require('../../src/utils/AppError');
class DeterministicProvider {
    constructor() { this.recipient = 'SYNTHETIC-MERCHANT'; this.currencies = ['USD']; this.orders = new Map(); this.createCalls = 0; this.collections = 0; this.mode = 'success'; }
    configuration() { return { available: true, provider: 'deterministic', currencies: this.currencies }; }
    async createOrder(payment) {
        const id = `ORDER-${payment._id}`;
        if (!this.orders.has(id)) { this.createCalls++; this.orders.set(id, { id, status: 'APPROVED', invoice_id: String(payment._id), violation_id: String(payment.violation_id), recipient: this.recipient, amount_minor: payment.amount_minor, currency: payment.currency, approval_url: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }); }
        if (this.mode === 'create-timeout') throw new Error('Synthetic timeout');
        return structuredClone(this.orders.get(id));
    }
    async getOrder(id) {
        if (this.mode === 'offline') throw new Error('Synthetic unavailable');
        const order = structuredClone(this.orders.get(id));
        if (this.mode === 'wrong-amount') order.amount_minor++;
        if (this.mode === 'wrong-currency') order.currency = 'EUR';
        if (this.mode === 'wrong-recipient') order.recipient = 'OTHER-SYNTHETIC-MERCHANT';
        if (this.mode === 'wrong-owner') order.invoice_id = 'unrelated';
        return order;
    }
    async captureOrder(id) {
        if (this.mode === 'decline') throw new AppError(409, 'PROVIDER_DECLINED', 'Synthetic decline');
        if (this.mode === 'pending') return this.getOrder(id);
        const order = this.orders.get(id);
        if (order.status !== 'COMPLETED') { this.collections++; Object.assign(order, { status: 'COMPLETED', capture_id: `CAP-${id}`, capture_status: 'COMPLETED', final_capture: true }); }
        if (this.mode === 'capture-timeout') throw new Error('Synthetic timeout after collection');
        return this.getOrder(id);
    }
    async verifyWebhook({ headers, rawBody }) {
        const expected = crypto.createHash('sha256').update(rawBody).digest('hex');
        if (headers['x-synthetic-signature'] !== expected) throw new AppError(400, 'INVALID_SIGNATURE', 'Synthetic signature invalid.');
        return JSON.parse(rawBody.toString('utf8'));
    }
}
module.exports = DeterministicProvider;

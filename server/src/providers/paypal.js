const AppError = require('../utils/AppError');
const { decimalToMinor, formatMinor } = require('../utils/money');
const BASE = 'https://api-m.sandbox.paypal.com';

class PayPalSandbox {
    constructor(env = process.env, fetcher = fetch) {
        this.clientId = env.PAYPAL_CLIENT_ID; this.secret = env.PAYPAL_CLIENT_SECRET;
        this.recipient = env.PAYPAL_MERCHANT_ID; this.webhookId = env.PAYPAL_WEBHOOK_ID;
        this.returnBase = env.PUBLIC_BASE_URL; this.fetcher = fetcher;
        this.currencies = ['USD'];
    }
    configuration() {
        let urlValid = false;
        try { const url = new URL(this.returnBase); urlValid = !url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))); } catch { /* Missing configuration is unavailable. */ }
        const available = Boolean(this.clientId && this.secret && this.recipient && this.webhookId && urlValid);
        return { available, provider: 'paypal', currencies: this.currencies, ...(available ? {} : { reason: 'Sandbox payments are not configured.' }) };
    }
    async token() {
        if (!this.configuration().available) throw new AppError(503, 'PAYMENTS_UNAVAILABLE', 'Sandbox payments are not configured.');
        if (this.accessToken && this.tokenUntil > Date.now()) return this.accessToken;
        const response = await this.fetcher(`${BASE}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Sandbox authentication is unavailable.');
        const body = await response.json();
        if (typeof body.access_token !== 'string' || !Number.isFinite(body.expires_in)) throw new AppError(502, 'PROVIDER_INVALID', 'Sandbox returned an invalid response.');
        this.accessToken = body.access_token; this.tokenUntil = Date.now() + Math.max(0, body.expires_in - 60) * 1000;
        return this.accessToken;
    }
    async request(path, { method = 'GET', body, requestId, rawBody } = {}) {
        const token = await this.token();
        const response = await this.fetcher(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) }, ...(body || rawBody ? { body: rawBody || JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new AppError(response.status === 422 ? 409 : 502, 'PROVIDER_UNCERTAIN', 'Check payment status before retrying.');
        return response.json();
    }
    normalize(order) {
        if (!order || typeof order.id !== 'string' || order.purchase_units?.length !== 1) throw new AppError(502, 'PROVIDER_INVALID', 'Invalid sandbox order.');
        const unit = order.purchase_units[0];
        const captures = unit.payments?.captures || [];
        if (captures.length > 1) throw new AppError(502, 'PROVIDER_MISMATCH', 'Unexpected capture count.');
        const capture = captures[0];
        const amount = capture?.amount || unit.amount;
        const approval = order.links?.find(link => ['approve', 'payer-action'].includes(link.rel));
        let approval_url;
        if (approval) {
            const url = new URL(approval.href);
            if (url.protocol !== 'https:' || url.hostname !== 'www.sandbox.paypal.com') throw new AppError(502, 'PROVIDER_INVALID', 'Invalid sandbox approval link.');
            approval_url = url.href;
        }
        return { id: order.id, status: order.status, invoice_id: unit.invoice_id, violation_id: unit.custom_id, recipient: unit.payee?.merchant_id,
            amount_minor: decimalToMinor(amount?.value, amount?.currency_code), currency: amount?.currency_code,
            capture_id: capture?.id, capture_status: capture?.status, final_capture: capture?.final_capture, approval_url };
    }
    async createOrder(payment) {
        const base = new URL(this.returnBase);
        const returnUrl = new URL('/violations', base); returnUrl.searchParams.set('payment', String(payment._id));
        const cancelUrl = new URL(returnUrl); cancelUrl.searchParams.set('checkout', 'cancelled');
        return this.normalize(await this.request('/v2/checkout/orders', { method: 'POST', requestId: `create-${payment._id}`, body: { intent: 'CAPTURE', purchase_units: [{ reference_id: String(payment._id), invoice_id: String(payment._id), custom_id: String(payment.violation_id), payee: { merchant_id: this.recipient }, amount: { currency_code: payment.currency, value: formatMinor(payment.amount_minor, payment.currency) } }], payment_source: { paypal: { experience_context: { return_url: returnUrl.href, cancel_url: cancelUrl.href, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' } } } } }));
    }
    async getOrder(id) { return this.normalize(await this.request(`/v2/checkout/orders/${encodeURIComponent(id)}`)); }
    async captureOrder(id, paymentId) { return this.normalize(await this.request(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, { method: 'POST', requestId: `capture-${paymentId}`, body: {} })); }
    async verifyWebhook({ headers, rawBody }) {
        const names = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
        if (!Buffer.isBuffer(rawBody) || names.some(name => typeof headers[name] !== 'string' || headers[name].length > 4096)) throw new AppError(400, 'INVALID_WEBHOOK', 'Missing webhook verification data.');
        const envelope = { auth_algo: headers[names[0]], cert_url: headers[names[1]], transmission_id: headers[names[2]], transmission_sig: headers[names[3]], transmission_time: headers[names[4]], webhook_id: this.webhookId };
        // Embed the ORIGINAL received JSON bytes, rather than reserializing the event.
        const raw = `${JSON.stringify(envelope).slice(0, -1)},"webhook_event":${rawBody.toString('utf8')}}`;
        const result = await this.request('/v1/notifications/verify-webhook-signature', { method: 'POST', rawBody: raw });
        if (result.verification_status !== 'SUCCESS') throw new AppError(400, 'INVALID_SIGNATURE', 'Webhook signature is invalid.');
        return JSON.parse(rawBody.toString('utf8'));
    }
}
let instance;
module.exports = { PayPalSandbox, getDefaultAdapter: () => (instance ||= new PayPalSandbox()) };

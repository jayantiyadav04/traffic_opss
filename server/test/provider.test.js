const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { PayPalSandbox } = require('../src/providers/paypal');

const payment = { _id: '012345678901234567890123', violation_id: '112345678901234567890123', amount_minor: 1250, currency: 'USD' };
function setup(extra = {}) {
    const calls = [];
    const env = { PAYPAL_CLIENT_ID: 'synthetic-client', PAYPAL_CLIENT_SECRET: randomBytes(24).toString('hex'), PAYPAL_MERCHANT_ID: 'SYNTHETIC-MERCHANT', PAYPAL_WEBHOOK_ID: 'SYNTHETIC-WEBHOOK', PUBLIC_BASE_URL: 'https://example.test', ...extra };
    const fetcher = async (url, options) => {
        calls.push({ url, options });
        let response;
        if (url.endsWith('/token')) response = { access_token: randomBytes(32).toString('hex'), expires_in: 3600 };
        else if (url.endsWith('/verify-webhook-signature')) response = { verification_status: 'SUCCESS' };
        else response = { id: 'SYNTHETIC-ORDER', status: url.endsWith('/capture') ? 'COMPLETED' : 'CREATED', purchase_units: [{ invoice_id: payment._id, custom_id: payment.violation_id, payee: { merchant_id: env.PAYPAL_MERCHANT_ID }, amount: { currency_code: 'USD', value: '12.50' }, ...(url.endsWith('/capture') ? { payments: { captures: [{ id: 'SYNTHETIC-CAPTURE', status: 'COMPLETED', final_capture: true, amount: { currency_code: 'USD', value: '12.50' } }] } } : {}) }], links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=SYNTHETIC-ORDER' }] };
        return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    return { adapter: new PayPalSandbox(env, fetcher), calls };
}
test('REST adapter uses only sandbox endpoints, authoritative amount and durable operation IDs', async () => {
    const { adapter, calls } = setup();
    assert.equal(adapter.configuration().available, true);
    const created = await adapter.createOrder(payment);
    const captured = await adapter.captureOrder(created.id, payment._id);
    assert.equal(created.amount_minor, 1250); assert.equal(captured.capture_id, 'SYNTHETIC-CAPTURE');
    assert.ok(calls.every(call => call.url.startsWith('https://api-m.sandbox.paypal.com/')));
    const create = calls.find(call => call.url.endsWith('/v2/checkout/orders'));
    const body = JSON.parse(create.options.body);
    assert.deepEqual(body.purchase_units[0].amount, { currency_code: 'USD', value: '12.50' });
    assert.equal(body.purchase_units[0].payee.merchant_id, adapter.recipient);
    assert.equal(create.options.headers['PayPal-Request-Id'], `create-${payment._id}`);
    assert.equal(calls.at(-1).options.headers['PayPal-Request-Id'], `capture-${payment._id}`);
    assert.equal(calls.filter(call => call.url.endsWith('/token')).length, 1);
});
test('webhook verification embeds original JSON bytes and configured webhook identity', async () => {
    const { adapter, calls } = setup();
    const rawBody = Buffer.from('{ "id" : "SYNTHETIC-EVENT", "event_type": "PAYMENT.CAPTURE.COMPLETED" }');
    const headers = { 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.paypal.com/synthetic-cert', 'paypal-transmission-id': 'synthetic-id', 'paypal-transmission-sig': 'synthetic-signature', 'paypal-transmission-time': '2026-11-11T00:00:00Z' };
    const parsed = await adapter.verifyWebhook({ headers, rawBody });
    assert.equal(parsed.id, 'SYNTHETIC-EVENT');
    assert.ok(calls.at(-1).options.body.includes(`"webhook_event":${rawBody.toString('utf8')}`));
    assert.equal(JSON.parse(calls.at(-1).options.body).webhook_id, 'SYNTHETIC-WEBHOOK');
    await assert.rejects(adapter.verifyWebhook({ headers: {}, rawBody }), { code: 'INVALID_WEBHOOK' });
});
test('adapter rejects unsafe checkout destinations and missing configuration', async () => {
    const { adapter } = setup();
    assert.equal(setup({ PUBLIC_BASE_URL: 'https://user:password@example.test' }).adapter.configuration().available, false);
    assert.equal(new PayPalSandbox({}).configuration().available, false);
    assert.throws(() => adapter.normalize({ id: 'SYNTHETIC-ORDER', purchase_units: [{ amount: { value: '1.00', currency_code: 'USD' } }], links: [{ rel: 'approve', href: 'https://attacker.example.test/' }] }), { code: 'PROVIDER_INVALID' });
});

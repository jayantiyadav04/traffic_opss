const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../api');

function response() {
    return { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
}
test('serverless liveness bypasses unavailable configuration/database; readiness does not', async () => {
    let validationCalls = 0; let connectionCalls = 0;
    const handler = createHandler({ application: (req, res) => res.json({ status: 'live' }),
        validate: () => { validationCalls++; throw new Error('Synthetic configuration unavailable'); }, connect: async () => { connectionCalls++; }, log: () => {} });
    for (const method of ['GET', 'HEAD']) {
        const res = response(); await handler({ method, url: '/api/health/live?check=1' }, res);
        assert.equal(res.statusCode, 200); assert.equal(res.body.status, 'live');
    }
    assert.equal(validationCalls, 0); assert.equal(connectionCalls, 0);
    const res = response(); await handler({ method: 'GET', url: '/api/health/ready' }, res);
    assert.equal(res.statusCode, 503); assert.equal(res.body.error.code, 'CONFIGURATION_INVALID');
});
test('configuration failure has a safe code and logs only an allowlisted field and request ID', async () => {
    const logs = []; const failure = Object.assign(new Error('SYNTHETIC-PRIVATE-VALUE'), { code: 'CONFIGURATION_INVALID', field: 'JWT_SECRET' });
    const handler = createHandler({ validate: () => { throw failure; }, connect: async () => assert.fail('Database must not be touched'), log: entry => logs.push(entry), requestId: () => 'synthetic-request' });
    const res = response(); await handler({ method: 'POST', url: '/api/auth/register' }, res);
    assert.equal(res.statusCode, 503); assert.equal(res.headers['X-Request-ID'], 'synthetic-request');
    assert.equal(res.body.error.code, 'CONFIGURATION_INVALID');
    assert.deepEqual(logs, [{ event: 'startup_failed', requestId: 'synthetic-request', phase: 'configuration', code: 'CONFIGURATION_INVALID', field: 'JWT_SECRET' }]);
    assert.equal(JSON.stringify({ logs, body: res.body }).includes('SYNTHETIC-PRIVATE-VALUE'), false);
});
test('database startup failures preserve safe classification without exposing raw errors', async () => {
    const logs = [];
    const failure = Object.assign(new Error('SYNTHETIC-PRIVATE-URI'), { code: 'DATABASE_INITIALIZATION_FAILED', cause: { code: 13 } });
    const handler = createHandler({ validate: () => {}, connect: async () => { throw failure; }, log: entry => logs.push(entry), requestId: () => 'synthetic-request' });
    const res = response(); await handler({ method: 'POST', url: '/api/auth/register' }, res);
    assert.equal(res.statusCode, 503); assert.equal(res.body.error.code, 'DATABASE_INITIALIZATION_FAILED');
    assert.equal(logs[0].databaseCode, 13); assert.equal(JSON.stringify({ logs, body: res.body }).includes('SYNTHETIC-PRIVATE-URI'), false);
});
test('valid serverless startup connects before dispatching the request', async () => {
    const order = [];
    const handler = createHandler({ validate: () => order.push('validate'), connect: async () => order.push('connect'), application: (req, res) => { order.push('app'); return res.json({ ok: true }); } });
    const res = response(); await handler({ method: 'POST', url: '/api/auth/register' }, res);
    assert.deepEqual(order, ['validate', 'connect', 'app']); assert.equal(res.body.ok, true);
});

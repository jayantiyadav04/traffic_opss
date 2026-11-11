const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const request = require('supertest');
const mongoose = require('mongoose');
const { startDatabase, clearDatabase, stopDatabase } = require('./helpers');
const { assertDisposableTarget, seedDatabase } = require('../seed');
const { configuration } = require('../src/config/env');
const User = require('../src/models/User');
const IdentityVerification = require('../src/models/IdentityVerification');
const Violation = require('../src/models/Violation');
const ViolationType = require('../src/models/ViolationType');
const Area = require('../src/models/Area');
let environment;
before(async () => { environment = await startDatabase(); });
after(stopDatabase);
beforeEach(clearDatabase);
test('seed refuses missing opt-in, production, remote, and mismatched database targets', () => {
    const base = { NODE_ENV: 'test', MONGO_URI: 'mongodb://127.0.0.1:27017/traffic_ops_demo', SEED_ALLOW_DISPOSABLE: 'true', SEED_CONFIRM_DATABASE: 'traffic_ops_demo' };
    assert.equal(assertDisposableTarget(base), 'traffic_ops_demo');
    for (const override of [{ SEED_ALLOW_DISPOSABLE: 'false' }, { NODE_ENV: 'production' }, { MONGO_URI: 'mongodb://example.invalid/traffic_ops_demo' }, { SEED_CONFIRM_DATABASE: 'other' }, { MONGO_URI: 'mongodb://127.0.0.1:27017/production', SEED_CONFIRM_DATABASE: 'production' }]) assert.throws(() => assertDisposableTarget({ ...base, ...override }));
});
test('synthetic seed is additive and idempotent without resetting passwords or deleting unrelated data', async () => {
    const password = randomBytes(24).toString('base64url');
    const retained = await User.create({ username: 'unrelated', full_name: 'Synthetic Existing Citizen', email: 'retained@example.invalid', password });
    const env = { NODE_ENV: 'test', MONGO_URI: environment.replica.getUri(environment.databaseName), SEED_ALLOW_DISPOSABLE: 'true', SEED_CONFIRM_DATABASE: environment.databaseName, SEED_ADMIN_PASSWORD: password, SEED_OFFICER_PASSWORD: password, SEED_CITIZEN_PASSWORD: password };
    assert.deepEqual(await seedDatabase(env), { users: 3, policies: 2, areas: 1 });
    const hash = (await User.findOne({ email: 'admin@example.invalid' }).select('+password')).password;
    await seedDatabase({ ...env, SEED_ADMIN_PASSWORD: randomBytes(24).toString('base64url') });
    assert.equal(await User.countDocuments(), 4);
    assert.ok(await User.findById(retained._id));
    assert.equal((await User.findOne({ email: 'admin@example.invalid' }).select('+password')).password, hash);
    assert.equal(await IdentityVerification.countDocuments(), 1);
});
test('seed role conflicts abort the transaction without privilege escalation', async () => {
    const password = randomBytes(24).toString('base64url');
    await User.create({ username: 'synthetic_admin', full_name: 'Synthetic Citizen', email: 'admin@example.invalid', password, role: 'citizen' });
    const env = { NODE_ENV: 'test', MONGO_URI: environment.replica.getUri(environment.databaseName), SEED_ALLOW_DISPOSABLE: 'true', SEED_CONFIRM_DATABASE: environment.databaseName, SEED_ADMIN_PASSWORD: password, SEED_OFFICER_PASSWORD: password, SEED_CITIZEN_PASSWORD: password };
    await assert.rejects(() => seedDatabase(env));
    assert.equal((await User.findOne({ email: 'admin@example.invalid' })).role, 'citizen');
    assert.equal(await User.countDocuments(), 1);
});
test('startup configuration rejects missing/weak secrets and invalid origins', () => {
    const original = { MONGO_URI: process.env.MONGO_URI, JWT_SECRET: process.env.JWT_SECRET, CLIENT_ORIGINS: process.env.CLIENT_ORIGINS, PORT: process.env.PORT };
    try {
        process.env.MONGO_URI = 'mongodb://127.0.0.1/traffic_ops_dev';
        process.env.JWT_SECRET = randomBytes(40).toString('hex');
        delete process.env.CLIENT_ORIGINS; delete process.env.PORT;
        assert.equal(configuration().port, 5000);
        process.env.JWT_SECRET = 'weak'; assert.throws(configuration);
        process.env.JWT_SECRET = 'replace-with-at-least-32-random-characters'; assert.throws(configuration);
        process.env.JWT_SECRET = randomBytes(40).toString('hex');
        process.env.CLIENT_ORIGINS = '*'; assert.throws(configuration);
        process.env.CLIENT_ORIGINS = 'https://example.invalid/path'; assert.throws(configuration);
        process.env.CLIENT_ORIGINS = 'https://example.invalid'; process.env.PORT = '-1'; assert.throws(configuration);
    } finally {
        for (const [key, value] of Object.entries(original)) value === undefined ? delete process.env[key] : process.env[key] = value;
    }
});
test('database readiness fails explicitly while liveness survives disconnection', async () => {
    await mongoose.disconnect();
    assert.equal((await request(environment.app).get('/api/health/live')).status, 200);
    const ready = await request(environment.app).get('/api/health/ready');
    assert.equal(ready.status, 503);
    assert.equal(ready.body.error.code, 'NOT_READY');
    assert.equal((await request(environment.app).get('/api/violations')).status, 503);
    await mongoose.connect(environment.replica.getUri(environment.databaseName), { bufferCommands: false });
});
test('invalid persisted money produces explicit dashboard failure instead of a zero total', async () => {
    const password = randomBytes(24).toString('base64url');
    const admin = await User.create({ username: 'admin_review', full_name: 'Synthetic Admin', email: 'admin_review@example.invalid', password, role: 'admin' });
    const type = await ViolationType.create({ type_name: 'Synthetic legacy', base_fine: 1 });
    const area = await Area.create({ area_name: 'Synthetic', city: 'Synthetic' });
    await Violation.collection.insertOne({ owner_name: 'Synthetic Legacy', vehicle_number: 'SYNTH-1', officer: admin._id, user: null, area: area._id, violation_type: type._id, fine_amount: -10, status: 'unpaid', createdAt: new Date() });
    const login = await request(environment.app).post('/api/auth/login').send({ email: admin.email, password });
    const response = await request(environment.app).get('/api/analytics/dashboard').set('Authorization', 'Bearer ' + login.body.token);
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'MONEY_REVIEW_REQUIRED');
    assert.equal(response.body.totals, undefined);
});

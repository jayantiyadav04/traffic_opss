const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
process.env.MONGOMS_DOWNLOAD_DIR ||= require('node:path').join(__dirname, '../.cache/mongodb-binaries');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const request = require('supertest');
const { ensureReady } = require('../src/config/db');
const app = require('../src/app');
let runtime;
process.env.NODE_ENV = 'test';
if (process.env.MONGO_URI || process.env.MONGODB_URI) throw new Error('Refusing inherited database configuration.');
after(async () => { await mongoose.disconnect(); if (runtime) await runtime.stop(); });
test('fresh replica startup waits for real unique indexes and refuses failed initialization', async t => {
    runtime = await MongoMemoryReplSet.create({ binary: { version: process.env.MONGOMS_VERSION || '7.0.24' }, replSet: { count: 1 } });
    await mongoose.connect(runtime.getUri('traffic_ops_test_' + randomUUID().replace(/-/g, '')));
    // A failing index initialization must gate ALL callers sharing the same startup promise.
    const probe = mongoose.model('StartupConstraintProbe', new mongoose.Schema({ key: { type: String, unique: true } }));
    await probe.init();
    t.mock.method(probe, 'createIndexes', async () => { throw new Error('Synthetic index initialization failure'); });
    const attempts = await Promise.allSettled([ensureReady(), ensureReady(), ensureReady()]);
    assert.ok(attempts.every(result => result.status === 'rejected' && result.reason.code === 'DATABASE_INITIALIZATION_FAILED'));
    t.mock.restoreAll();
    await ensureReady();
    const indexes = await mongoose.connection.collection('idempotencyrecords').indexes();
    assert.ok(indexes.some(index => index.unique && index.key.actor_id === 1 && index.key.operation === 1 && index.key.key === 1));
    assert.equal((await request(app).get('/api/health/ready')).status, 200);
});

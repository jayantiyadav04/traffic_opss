const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { startDatabase, clearDatabase, stopDatabase } = require('./helpers');
const User = require('../src/models/User');
const Violation = require('../src/models/Violation');
const ViolationType = require('../src/models/ViolationType');
const Area = require('../src/models/Area');
const IdentityReview = require('../src/models/IdentityReview');
const IdentityVerification = require('../src/models/IdentityVerification');
let app, citizen, other, officer, admin, type, area;
const password = randomBytes(24).toString('base64url');
const token = (user, overrides = {}, options = {}) => jwt.sign({ id: user.id, version: user.token_version || 0, ...overrides }, process.env.JWT_SECRET, { expiresIn: '15m', issuer: 'traffic-ops', audience: 'traffic-ops-client', ...options });
const authorized = (method, path, user = officer) => request(app)[method](path).set('Authorization', 'Bearer ' + token(user));
const issueBody = (overrides = {}) => ({ citizen_id: citizen.id, vehicle_number: 'TEST-100', violation_type: type.id, area: area.id, ...overrides });
const record = (user = citizen, overrides = {}) => ({ user: user._id, ownership_verified: true, schema_version: 2, vehicle_number: 'TEST-100', owner_name: user.full_name, officer: officer._id, violation_type: type._id, area: area._id, amount_minor: 12345, currency: 'INR', fine_amount: 123.45, policy_version: 1, ...overrides });
before(async () => { ({ app } = await startDatabase()); });
after(stopDatabase);
beforeEach(async () => {
    await clearDatabase();
    [citizen, other, officer, admin] = await User.create([
        { username: 'citizen_a', full_name: 'Synthetic Same Name', email: 'a@example.invalid', password, role: 'citizen', onboarding_status: 'verified' },
        { username: 'citizen_b', full_name: 'Synthetic Same Name', email: 'b@example.invalid', password, role: 'citizen', onboarding_status: 'verified' },
        { username: 'officer_a', full_name: 'Synthetic Officer', email: 'officer@example.invalid', password, role: 'officer', onboarding_status: 'verified' },
        { username: 'admin_a', full_name: 'Synthetic Admin', email: 'admin@example.invalid', password, role: 'admin', onboarding_status: 'verified' },
    ]);
    type = await ViolationType.create({ type_name: 'Synthetic policy', amount_minor: 12345, currency: 'INR', policy_version: 3 });
    area = await Area.create({ area_name: 'Synthetic Junction', city: 'Test City' });
});
test('public signup rejects privileged roles and only creates pending citizens', async () => {
    for (const role of ['admin', 'officer']) {
        const response = await request(app).post('/api/auth/register').send({ username: 'new_user', full_name: 'Synthetic Person', email: 'new@example.invalid', password, role });
        assert.equal(response.status, 400);
        assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    }
    const response = await request(app).post('/api/auth/register').send({ username: 'new_user', full_name: 'Synthetic Person', email: 'NEW@example.invalid', password });
    assert.equal(response.status, 201);
    assert.equal(response.body.role, 'citizen');
    assert.equal(response.body.onboarding_status, 'pending');
    assert.equal(response.body.email, 'new@example.invalid');
    assert.equal(response.body.password, undefined);
    assert.equal((await User.findOne({ email: 'new@example.invalid' })).role, 'citizen');
});
test('signup validates objects, unknown fields, duplicate identifiers, and bounded credentials', async () => {
    const base = { username: 'new_user', full_name: 'Synthetic Person', email: 'new@example.invalid', password };
    assert.equal((await request(app).post('/api/auth/register').send({ ...base, email: { $ne: null } })).status, 400);
    assert.equal((await request(app).post('/api/auth/register').send({ ...base, onboarding_status: 'verified' })).status, 400);
    assert.equal((await request(app).post('/api/auth/register').send({ ...base, password: 'short' })).status, 400);
    assert.equal((await request(app).post('/api/auth/register').send({ ...base, email: 'A@example.invalid' })).status, 409);
});
test('real login and me expose safe user data; invalid and expired sessions fail', async () => {
    const response = await request(app).post('/api/auth/login').send({ email: citizen.email, password });
    assert.equal(response.status, 200);
    assert.equal(response.body.full_name, citizen.full_name);
    assert.equal(response.body.password, undefined);
    assert.equal(response.body.token_version, undefined);
    const me = await request(app).get('/api/auth/me').set('Authorization', 'Bearer ' + response.body.token);
    assert.equal(me.status, 200);
    assert.equal(me.body.token, undefined);
    assert.equal(me.body.password, undefined);
    assert.equal(me.body.token_version, undefined);
    assert.equal((await request(app).get('/api/auth/me')).status, 401);
    assert.equal((await request(app).get('/api/auth/me').set('Authorization', 'Bearer invalid')).status, 401);
    assert.equal((await request(app).get('/api/auth/me').set('Authorization', 'Bearer ' + token(citizen, {}, { expiresIn: -1 }))).status, 401);
    assert.equal((await request(app).post('/api/auth/login').send({ email: citizen.email, password: 'incorrect' })).status, 401);
});
test('password hashes once on create/change and unchanged saves preserve the hash', async () => {
    let user = await User.findById(citizen._id).select('+password +token_version');
    const initial = user.password;
    assert.notEqual(initial, password);
    assert.equal(await user.matchPassword(password), true);
    user.full_name = 'Updated Synthetic Name';
    await user.save();
    assert.equal(user.password, initial);
    const next = randomBytes(24).toString('base64url');
    const changed = await authorized('patch', '/api/auth/password', citizen).send({ current_password: password, new_password: next });
    assert.equal(changed.status, 200);
    user = await User.findById(citizen._id).select('+password +token_version');
    assert.notEqual(user.password, initial);
    assert.equal(await user.matchPassword(next), true);
    assert.equal(await user.matchPassword(password), false);
    assert.equal((await authorized('get', '/api/auth/me', citizen)).status, 401);
    assert.equal((await request(app).get('/api/auth/me').set('Authorization', 'Bearer ' + changed.body.token)).status, 200);
});
test('logout revokes old sessions server-side', async () => {
    const bearer = token(citizen);
    assert.equal((await request(app).post('/api/auth/logout').set('Authorization', 'Bearer ' + bearer)).status, 204);
    assert.equal((await request(app).get('/api/auth/me').set('Authorization', 'Bearer ' + bearer)).status, 401);
});
test('concurrent password changes cannot overwrite a new hash or reuse the session version', async () => {
    const next = [randomBytes(24).toString('base64url'), randomBytes(24).toString('base64url')];
    const replies = await Promise.all(next.map(value => authorized('patch', '/api/auth/password', citizen).send({ current_password: password, new_password: value })));
    assert.equal(replies.filter(reply => reply.status === 200).length, 1);
    assert.ok(replies.some(reply => [401, 409].includes(reply.status)));
    const user = await User.findById(citizen._id).select('+password +token_version');
    assert.equal(user.token_version, 1);
    assert.equal(await user.matchPassword(next[replies.findIndex(reply => reply.status === 200)]), true);
    assert.equal((await authorized('get', '/api/auth/me', citizen)).status, 401);
});
test('only admin provisions privileged users and no credential is returned', async () => {
    const body = { username: 'new_officer', full_name: 'Synthetic Officer Two', email: 'new_officer@example.invalid', password, role: 'officer' };
    assert.equal((await authorized('post', '/api/auth/users', citizen).send(body)).status, 403);
    assert.equal((await authorized('post', '/api/auth/users', officer).send(body)).status, 403);
    const response = await authorized('post', '/api/auth/users', admin).send(body);
    assert.equal(response.status, 201);
    assert.equal(response.body.role, 'officer');
    assert.equal(response.body.password, undefined);
    assert.equal(response.body.token, undefined);
});
test('officer verifies self-created citizen by exact account with durable identity evidence', async () => {
    const pending = await User.create({ username: 'pending_user', full_name: citizen.full_name, email: 'pending@example.invalid', password });
    assert.equal((await authorized('get', '/api/auth/citizens?email=pending%40example.invalid', citizen)).status, 403);
    const lookup = await authorized('get', '/api/auth/citizens?email=pending%40example.invalid');
    assert.equal(lookup.status, 200);
    assert.equal(lookup.body[0]._id, pending.id);
    assert.equal(lookup.body[0].password, undefined);
    assert.equal((await authorized('post', '/api/violations').send(issueBody({ citizen_id: pending.id }))).status, 400);
    const verified = await authorized('post', '/api/auth/citizens/' + pending.id + '/verify').send({ reference: 'SYNTHETIC-PROOF-1' });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.onboarding_status, 'verified');
    assert.equal(await IdentityVerification.countDocuments({ citizen_id: pending._id, actor_id: officer._id }), 1);
    assert.equal((await authorized('post', '/api/auth/citizens/' + pending.id + '/verify').send({ reference: 'SYNTHETIC-PROOF-2' })).status, 409);
});
test('issue resolves citizen display and authoritative fine policy; rejects client claims', async () => {
    const response = await authorized('post', '/api/violations').send(issueBody());
    assert.equal(response.status, 201);
    assert.equal(response.body.owner_name, citizen.full_name);
    assert.equal(response.body.user, citizen.id);
    assert.equal(response.body.amount_minor, 12345);
    assert.equal(response.body.currency, 'INR');
    assert.equal(response.body.policy_version, 3);
    assert.equal(response.body.ownership_verified, true);
    assert.equal(response.body.newUser, undefined);
    for (const claim of [{ fine_amount: 1 }, { amount_minor: 1 }, { currency: 'USD' }, { owner_name: 'Other Name' }]) {
        assert.equal((await authorized('post', '/api/violations').send(issueBody(claim))).status, 400);
    }
    assert.equal((await authorized('post', '/api/violations', citizen).send(issueBody())).status, 403);
});
test('issue rejects invalid references, objects, identifiers, and notes', async () => {
    const unknown = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    for (const override of [{ citizen_id: unknown }, { violation_type: unknown }, { area: unknown }, { area: 'bad-id' }, { vehicle_number: { $ne: '' } }, { notes: 'x'.repeat(2001) }]) {
        assert.equal((await authorized('post', '/api/violations').send(issueBody(override))).status, 400);
    }
    assert.equal(await Violation.countDocuments(), 0);
});
test('same-name citizen records remain isolated while officer operational access is preserved', async () => {
    const [first, second] = await Violation.create([record(citizen), record(other)]);
    const listed = await authorized('get', '/api/violations', citizen);
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.items.map((item) => item._id), [first.id]);
    assert.equal((await authorized('get', '/api/violations/' + second.id, citizen)).status, 404);
    assert.equal((await authorized('get', '/api/violations/' + second.id)).status, 200);
    assert.equal((await authorized('get', '/api/violations')).body.items.length, 2);
});
test('legacy ownership is quarantined and explicit audited review cannot reassign verified ownership', async () => {
    const legacy = await Violation.create(record(citizen, { ownership_verified: false }));
    assert.equal((await authorized('get', '/api/violations', citizen)).body.items.length, 0);
    const reviewed = await authorized('post', '/api/violations/' + legacy.id + '/ownership').send({ citizen_id: other.id, reference: 'SYNTHETIC-REVIEW-1' });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.user, other.id);
    assert.equal(await IdentityReview.countDocuments({ violation_id: legacy._id, prior_user_id: citizen._id, citizen_id: other._id }), 1);
    assert.equal((await authorized('get', '/api/violations/' + legacy.id, citizen)).status, 404);
    assert.equal((await authorized('get', '/api/violations/' + legacy.id, other)).status, 200);
    assert.equal((await authorized('post', '/api/violations/' + legacy.id + '/ownership').send({ citizen_id: citizen.id, reference: 'SYNTHETIC-REVIEW-2' })).status, 409);
});
test('cursor pagination is stable at equal timestamps and binds scope/filter', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    await Violation.create([record(citizen, { createdAt }), record(citizen, { createdAt }), record(citizen, { createdAt }), record(other, { createdAt })]);
    const first = await authorized('get', '/api/violations?limit=2', citizen);
    assert.equal(first.status, 200); assert.equal(first.body.items.length, 2); assert.equal(first.body.page.hasMore, true);
    const next = first.body.page.nextCursor;
    const second = await authorized('get', '/api/violations?limit=2&cursor=' + next, citizen);
    assert.equal(second.status, 200); assert.equal(second.body.items.length, 1); assert.equal(second.body.page.hasMore, false);
    assert.equal(new Set([...first.body.items, ...second.body.items].map((item) => item._id)).size, 3);
    assert.equal((await authorized('get', '/api/violations?limit=2&cursor=' + next, other)).status, 400);
    assert.equal((await authorized('get', '/api/violations?status=paid&cursor=' + next, citizen)).status, 400);
});
test('vehicle/status/date filters remain owned and reject malformed queries', async () => {
    await Violation.create([
        record(citizen, { vehicle_number: 'TEST-123', violation_date: new Date('2026-01-02T00:00:00Z') }),
        record(citizen, { vehicle_number: 'OTHER-123', status: 'paid', violation_date: new Date('2026-01-01T00:00:00Z') }),
        record(other, { vehicle_number: 'TEST-123', violation_date: new Date('2026-01-02T00:00:00Z') }),
    ]);
    const filtered = await authorized('get', '/api/violations?vehicle_number=TEST&status=unpaid&date_from=2026-01-02T00:00:00Z&date_to=2026-01-03T00:00:00Z', citizen);
    assert.equal(filtered.status, 200); assert.equal(filtered.body.items.length, 1);
    for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'cursor=broken', 'status=unknown', 'user=other', 'vehicle_number=%5B', 'date_from=2026-02-30T00:00:00Z', 'date_from=2026-01-03T00:00:00Z&date_to=2026-01-02T00:00:00Z']) {
        assert.equal((await authorized('get', '/api/violations?' + query, citizen)).status, 400);
    }
});
test('dashboard scopes counts and currencies; existing admin reports remain admin-only', async () => {
    const anotherOfficer = await User.create({ username: 'officer_b', full_name: 'Synthetic Officer B', email: 'officer_b@example.invalid', password, role: 'officer' });
    await Violation.create([record(citizen), record(other, { currency: 'USD', amount_minor: 500, fine_amount: undefined, status: 'paid' }), record(other, { officer: anotherOfficer._id, status: 'disputed' })]);
    const mine = await authorized('get', '/api/analytics/dashboard', citizen);
    assert.equal(mine.body.scope, 'citizen-owned'); assert.equal(mine.body.counts.total, 1);
    const issued = await authorized('get', '/api/analytics/dashboard');
    assert.equal(issued.body.scope, 'officer-issued'); assert.equal(issued.body.counts.total, 2);
    assert.deepEqual(issued.body.totals.map((row) => row.currency), ['INR', 'USD']);
    const global = await authorized('get', '/api/analytics/dashboard', admin);
    assert.equal(global.body.counts.total, 3); assert.equal(global.body.counts.disputed, 1);
    assert.equal((await authorized('get', '/api/analytics/stats')).status, 403);
    assert.equal((await authorized('get', '/api/analytics/by-type', citizen)).status, 403);
    assert.equal((await authorized('get', '/api/analytics/stats', admin)).status, 200);
});
test('money schemas reject unsafe fractions and unknown currencies', async () => {
    await assert.rejects(() => Violation.create(record(citizen, { amount_minor: 1.1 })));
    await assert.rejects(() => Violation.create(record(citizen, { currency: 'ZZZ' })));
    await assert.rejects(() => ViolationType.create({ type_name: 'Invalid policy', amount_minor: 10 }));
});
test('errors carry request IDs and safe messages; origin and malformed JSON are rejected', async () => {
    const invalid = await authorized('get', '/api/violations/invalid');
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.requestId, invalid.headers['x-request-id']);
    assert.equal(typeof invalid.body.error.code, 'string');
    assert.equal(invalid.body.stack, undefined);
    assert.equal((await request(app).get('/api/health/live').set('Origin', 'https://untrusted.invalid')).status, 403);
    const badJson = await request(app).post('/api/auth/login').type('json').send('{"email":');
    assert.equal(badJson.status, 400); assert.equal(badJson.body.error.code, 'INVALID_JSON');
    assert.equal((await request(app).get('/api/unknown')).status, 404);
});
test('durable login rate limits return 429 with retry-after', async () => {
    let last;
    for (let i = 0; i < 21; i++) last = await request(app).post('/api/auth/login').send({ email: 'unknown@example.invalid', password });
    assert.equal(last.status, 429);
    assert.equal(last.body.error.code, 'RATE_LIMITED');
    assert.ok(Number(last.headers['retry-after']) > 0);
});
test('live and ready endpoints check connected database without disclosing configuration', async () => {
    const live = await request(app).get('/api/health/live');
    const ready = await request(app).get('/api/health/ready');
    assert.equal(live.status, 200); assert.equal(ready.status, 200);
    assert.deepEqual(ready.body, { status: 'ready' });
});

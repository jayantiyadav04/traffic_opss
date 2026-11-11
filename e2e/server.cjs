const { createRequire } = require('node:module');
const { randomBytes, randomUUID } = require('node:crypto');
const path = require('node:path');
const requireServer = createRequire(path.resolve(__dirname, '../server/package.json'));
const { MongoMemoryReplSet } = requireServer('mongodb-memory-server');
const mongoose = requireServer('mongoose');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.LOG_LEVEL = 'silent';
process.env.CLIENT_ORIGINS = 'http://127.0.0.1:4173';
for (const name of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MERCHANT_ID', 'PAYPAL_WEBHOOK_ID', 'PUBLIC_BASE_URL']) process.env[name] = '';
let replica;
let listener;
let stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (listener) await new Promise((resolve) => listener.close(resolve));
  await mongoose.disconnect();
  if (replica) await replica.stop();
  process.exit(code);
}

async function main() {
  if (!process.env.E2E_SYNTHETIC_PASSWORD || process.env.E2E_SYNTHETIC_PASSWORD.length < 24) {
    throw new Error('The browser runner must generate the synthetic fixture password.');
  }
  replica = await MongoMemoryReplSet.create({ binary: { version: process.env.MONGOMS_VERSION || '7.0.24' }, replSet: { count: 1 } });
  process.env.MONGO_URI = replica.getUri(`traffic_ops_test_e2e_${randomUUID().replaceAll('-', '')}`);
  await mongoose.connect(process.env.MONGO_URI);
  const User = requireServer('./src/models/User');
  const Area = requireServer('./src/models/Area');
  const ViolationType = requireServer('./src/models/ViolationType');
  const Violation = requireServer('./src/models/Violation');
  const models = [User, Area, ViolationType, Violation];
  await Promise.all(models.map((Model) => Model.init()));
  const users = {};
  for (const role of ['admin', 'officer', 'citizen']) {
    users[role] = await User.create({ username: `e2e_${role}`, full_name: `Synthetic ${role}`, email: `${role}@e2e.example.test`, password: process.env.E2E_SYNTHETIC_PASSWORD, role, onboarding_status: 'verified' });
  }
  const otherCitizen = await User.create({ username: 'e2e_other_citizen', full_name: 'Synthetic citizen', email: 'other@e2e.example.test', password: process.env.E2E_SYNTHETIC_PASSWORD, role: 'citizen', onboarding_status: 'verified', verified_by: users.officer._id, verified_at: new Date() });
  const area = await Area.create({ area_name: 'Synthetic browser sector', city: 'Test city' });
  const type = await ViolationType.create({ type_name: 'Synthetic browser policy', base_fine: 250, amount_minor: 25000, currency: 'INR', policy_version: 1 });
  await Violation.create([
    { user: users.citizen._id, ownership_verified: true, officer: users.officer._id, owner_name: users.citizen.full_name, vehicle_number: 'E2EOWN0001', violation_type: type._id, area: area._id, amount_minor: 25000, currency: 'INR', fine_amount: 250, schema_version: 2, policy_version: 1, status: 'unpaid' },
    { user: otherCitizen._id, ownership_verified: true, officer: users.officer._id, owner_name: otherCitizen.full_name, vehicle_number: 'E2EOTHER01', violation_type: type._id, area: area._id, amount_minor: 25000, currency: 'INR', fine_amount: 250, schema_version: 2, policy_version: 1, status: 'unpaid' },
  ]);
  const appModule = requireServer('./src/app');
  const app = appModule.createApp ? appModule.createApp() : appModule;
  await Promise.all(Object.values(mongoose.models).map((Model) => Model.init()));
  listener = app.listen(5000, '127.0.0.1', () => console.log('Disposable browser fixture API ready.'));
  listener.on('error', () => stop(1));
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
main().catch(async () => {
  console.error('Disposable browser fixture API failed; no existing database was used.');
  await stop(1);
});

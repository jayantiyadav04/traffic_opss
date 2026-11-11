import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem, platform } from 'node:os';

const requireServer = createRequire(new URL('../server/package.json', import.meta.url));
const { MongoMemoryReplSet } = requireServer('mongodb-memory-server');
const mongoose = requireServer('mongoose');

const options = { records: 1000, concurrency: 8, duration: 5 };
for (const argument of process.argv.slice(2)) {
  const match = /^--(records|concurrency|duration)=(\d+)$/.exec(argument);
  if (!match) throw new Error('Use --records=N --concurrency=N --duration=N.');
  options[match[1]] = Number(match[2]);
}
if (options.records < 100 || options.records > 100000 || options.concurrency < 1 || options.concurrency > 64 || options.duration < 1 || options.duration > 60) {
  throw new Error('Bounds: records 100..100000, concurrency 1..64, duration 1..60 seconds.');
}

// This command never accepts a database URI: it owns a new disposable replica set.
// No existing database or environment file is read, seeded, or dropped.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.LOG_LEVEL = 'silent';
for (const name of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MERCHANT_ID', 'PAYPAL_WEBHOOK_ID', 'PUBLIC_BASE_URL']) process.env[name] = '';
let replica;
let server;
try {
  replica = await MongoMemoryReplSet.create({
    binary: { version: process.env.MONGOMS_VERSION || '7.0.24' },
    replSet: { count: 1 },
  });
  const databaseName = `traffic_ops_test_load_${randomUUID().replaceAll('-', '')}`;
  process.env.MONGO_URI = replica.getUri(databaseName);
  await mongoose.connect(process.env.MONGO_URI);
  const User = requireServer('./src/models/User');
  const Area = requireServer('./src/models/Area');
  const ViolationType = requireServer('./src/models/ViolationType');
  const Violation = requireServer('./src/models/Violation');
  const password = randomBytes(24).toString('hex');
  const officer = await User.create({ username: 'synthetic_load_officer', full_name: 'Synthetic load officer', email: 'officer@load.example.test', password, role: 'officer', onboarding_status: 'verified' });
  const citizen = await User.create({ username: 'synthetic_load_citizen', full_name: 'Synthetic load citizen', email: 'citizen@load.example.test', password, role: 'citizen', onboarding_status: 'verified', verified_by: officer._id, verified_at: new Date() });
  const area = await Area.create({ area_name: 'Synthetic load sector', city: 'Test city' });
  const type = await ViolationType.create({ type_name: 'Synthetic load policy', base_fine: 250, amount_minor: 25000, currency: 'INR', policy_version: 1 });
  const started = Date.now();
  await Violation.insertMany(Array.from({ length: options.records }, (_, index) => ({
    user: citizen._id,
    ownership_verified: true,
    officer: officer._id,
    owner_name: citizen.full_name,
    vehicle_number: `TEST${String(index).padStart(8, '0')}`,
    violation_type: type._id,
    area: area._id,
    amount_minor: 25000,
    currency: 'INR',
    fine_amount: 250,
    schema_version: 2,
    policy_version: 1,
    status: 'unpaid',
    violation_date: new Date(started - index * 1000),
    createdAt: new Date(started - Math.floor(index / 5) * 1000),
    updatedAt: new Date(started),
  })));
  await Violation.syncIndexes();
  const appModule = requireServer('./src/app');
  const app = appModule.createApp ? appModule.createApp() : appModule;
  server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.on('error', reject);
  });
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseURL}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: citizen.email, password }) });
  if (!login.ok) throw new Error(`Synthetic load login failed (${login.status}).`);
  const session = await login.json();
  if (!session.token) throw new Error('Synthetic login returned no access token.');
  const paths = ['/api/violations?limit=20', '/api/violations?limit=20&status=unpaid&vehicle_number=TEST000', '/api/analytics/dashboard'];
  const headers = { Authorization: `Bearer ${session.token}` };
  for (const path of paths) {
    const response = await fetch(`${baseURL}${path}`, { headers });
    await response.arrayBuffer();
    if (!response.ok) throw new Error(`Warmup failed (${response.status}).`);
  }
  const latencies = [];
  const statuses = {};
  let failures = 0;
  const benchmarkStart = performance.now();
  const deadline = benchmarkStart + options.duration * 1000;
  await Promise.all(Array.from({ length: options.concurrency }, async (_, worker) => {
    let iteration = worker;
    while (performance.now() < deadline) {
      const requestStart = performance.now();
      try {
        const response = await fetch(`${baseURL}${paths[iteration++ % paths.length]}`, { headers, signal: AbortSignal.timeout(10000) });
        await response.arrayBuffer();
        statuses[response.status] = (statuses[response.status] || 0) + 1;
        if (!response.ok) failures++;
      } catch {
        failures++;
        statuses.network_error = (statuses.network_error || 0) + 1;
      }
      latencies.push(performance.now() - requestStart);
    }
  }));
  const elapsedSeconds = (performance.now() - benchmarkStart) / 1000;
  latencies.sort((a, b) => a - b);
  const percentile = (p) => Number(latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)].toFixed(2));
  const plan = await Violation.find({ user: citizen._id, ownership_verified: true }).sort({ createdAt: -1, _id: -1 }).limit(21).explain('executionStats');
  const filteredPlan = await Violation.find({ user: citizen._id, ownership_verified: true, status: 'unpaid', vehicle_number: /^TEST000/ }).sort({ createdAt: -1, _id: -1 }).limit(21).explain('executionStats');
  const stages = (node) => {
    if (!node || typeof node !== 'object') return [];
    return [...(node.stage ? [node.stage] : []), ...Object.values(node).flatMap((value) => Array.isArray(value) ? value.flatMap(stages) : stages(value))];
  };
  console.log(JSON.stringify({
    kind: 'isolated-synthetic-local-benchmark',
    environment: { node: process.version, platform: platform(), cpu: cpus()[0]?.model, cpuCount: cpus().length, memoryGiB: Number((totalmem() / 2 ** 30).toFixed(1)), mongodb: process.env.MONGOMS_VERSION || '7.0.24' },
    dataset: { records: options.records, citizens: 1, officers: 1, currency: 'INR' },
    requestMix: paths,
    warmupRequests: paths.length,
    concurrency: options.concurrency,
    durationSeconds: Number(elapsedSeconds.toFixed(2)),
    requests: latencies.length,
    requestsPerSecond: Number((latencies.length / elapsedSeconds).toFixed(2)),
    failures,
    errorRate: Number((failures / latencies.length).toFixed(4)),
    statusCounts: statuses,
    latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) },
    scopedListQuery: { stages: [...new Set(stages(plan.queryPlanner.winningPlan))], returned: plan.executionStats.nReturned, keysExamined: plan.executionStats.totalKeysExamined, documentsExamined: plan.executionStats.totalDocsExamined },
    filteredListQuery: { stages: [...new Set(stages(filteredPlan.queryPlanner.winningPlan))], returned: filteredPlan.executionStats.nReturned, keysExamined: filteredPlan.executionStats.totalKeysExamined, documentsExamined: filteredPlan.executionStats.totalDocsExamined },
    limitation: 'Synthetic loopback test, including one-citizen aggregation; not a production capacity claim.',
  }, null, 2));
  if (failures) process.exitCode = 1;
} finally {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  if (replica) await replica.stop();
}

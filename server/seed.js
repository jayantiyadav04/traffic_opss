const mongoose = require('mongoose');
const User = require('./src/models/User');
const ViolationType = require('./src/models/ViolationType');
const Area = require('./src/models/Area');
const IdentityVerification = require('./src/models/IdentityVerification');
const v = require('./src/utils/validation');
const connectDB = require('./src/config/db');
function assertDisposableTarget(env) {
    if (env.SEED_ALLOW_DISPOSABLE !== 'true' || env.NODE_ENV === 'production') throw new Error('Seeding requires explicit disposable local database opt-in.');
    let url;
    try { url = new URL(env.MONGO_URI); } catch { throw new Error('A local disposable MongoDB URI is required.'); }
    const database = decodeURIComponent(url.pathname.slice(1));
    if (url.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Seeding is restricted to local unauthenticated disposable databases.');
    if (!/^traffic_ops_(?:dev|demo|test_[a-f0-9]+)$/.test(database) || env.SEED_CONFIRM_DATABASE !== database) throw new Error('Confirm the exact disposable database name before seeding.');
    return database;
}
async function seedDatabase(env = process.env) {
    const database = assertDisposableTarget(env);
    const credentials = [
        { username: 'synthetic_admin', full_name: 'Synthetic Administrator', email: 'admin@example.invalid', role: 'admin', password: v.password(env.SEED_ADMIN_PASSWORD, 'SEED_ADMIN_PASSWORD') },
        { username: 'synthetic_officer', full_name: 'Synthetic Officer', email: 'officer@example.invalid', role: 'officer', password: v.password(env.SEED_OFFICER_PASSWORD, 'SEED_OFFICER_PASSWORD') },
        { username: 'synthetic_citizen', full_name: 'Synthetic Citizen', email: 'citizen@example.invalid', role: 'citizen', password: v.password(env.SEED_CITIZEN_PASSWORD, 'SEED_CITIZEN_PASSWORD') },
    ];
    if (mongoose.connection.readyState !== 1) {
        if (env !== process.env) throw new Error('Connect the explicitly checked disposable database before calling the seed library.');
        await connectDB();
    }
    if (mongoose.connection.name !== database) throw new Error('Connected database does not match the confirmed disposable target.');
    await Promise.all([User.init(), ViolationType.init(), Area.init(), IdentityVerification.init()]);
    await mongoose.connection.transaction(async (session) => {
        const users = [];
        for (const input of credentials) {
            let user = await User.findOne({ email: input.email }).session(session);
            if (user && (user.username !== input.username || user.role !== input.role)) throw new Error('Existing synthetic identity conflicts with seed roles; manual review is required.');
            if (!user) [user] = await User.create([{ ...input, onboarding_status: 'verified' }], { session });
            users.push(user);
        }
        const [admin, , citizen] = users;
        if (!citizen.verified_at) {
            citizen.onboarding_status = 'verified'; citizen.verified_by = admin._id; citizen.verified_at = new Date();
            await citizen.save({ session });
            await IdentityVerification.create([{ citizen_id: citizen._id, actor_id: admin._id, reference: 'SYNTHETIC-DISPOSABLE-SEED', verified_at: citizen.verified_at }], { session });
        }
        for (const policy of [
            { type_name: 'Synthetic demo INR fine', amount_minor: 10000, currency: 'INR', base_fine: 100, policy_version: 1 },
            { type_name: 'Synthetic sandbox USD fine', amount_minor: 500, currency: 'USD', policy_version: 1 },
        ]) await ViolationType.updateOne({ type_name: policy.type_name }, { $setOnInsert: policy }, { upsert: true, session, runValidators: true });
        await Area.updateOne({ area_name: 'Synthetic Junction', city: 'Demo City' }, { $setOnInsert: { area_name: 'Synthetic Junction', city: 'Demo City' } }, { upsert: true, session, runValidators: true });
    });
    return { users: 3, policies: 2, areas: 1 };
}
if (require.main === module) {
    require('dotenv').config({ path: require('node:path').join(__dirname, '.env'), quiet: true });
    seedDatabase().then((counts) => console.log(JSON.stringify({ event: 'synthetic_seed_complete', ...counts })))
        .catch(() => { console.error(JSON.stringify({ event: 'synthetic_seed_failed', message: 'Check disposable target opt-in, confirmation, and locally configured seed credentials.' })); process.exitCode = 1; })
        .finally(() => mongoose.disconnect());
}
module.exports = { assertDisposableTarget, seedDatabase };

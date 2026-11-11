const mongoose = require('mongoose');
const { moneyFromLegacy, validateMoney } = require('../src/utils/money');

async function migrateMoney({ dryRun = true, connection = mongoose.connection } = {}) {
    const report = { dryRun, scanned: 0, eligible: 0, migrated: 0, skipped: 0, invalid: [], total_minor: 0, currency: 'INR' };
    for (const [collectionName, legacyField] of [['violations', 'fine_amount'], ['violationtypes', 'base_fine']]) {
        const collection = connection.collection(collectionName);
        for await (const record of collection.find({})) {
            report.scanned++;
            if (Object.hasOwn(record, 'amount_minor') || Object.hasOwn(record, 'currency') || record.schema_version === 2) {
                try { validateMoney(record.amount_minor, record.currency); report.skipped++; }
                catch { report.invalid.push({ collection: collectionName, id: String(record._id), code: 'INVALID_EXISTING_MONEY' }); }
                continue;
            }
            let money;
            try { money = moneyFromLegacy(record[legacyField]); }
            catch (error) { report.invalid.push({ collection: collectionName, id: String(record._id), code: error.code || 'INVALID_MONEY' }); continue; }
            report.eligible++; report.total_minor += money.amount_minor;
            if (!Number.isSafeInteger(report.total_minor)) throw new Error('Migration total exceeds the safe integer bound');
            if (!dryRun) {
                const update = await collection.updateOne({ _id: record._id, [legacyField]: record[legacyField], amount_minor: { $exists: false }, currency: { $exists: false } },
                    { $set: { ...money, schema_version: 2, ...(collectionName === 'violations' ? { ownership_verified: false } : { policy_version: 1 }) } });
                report.migrated += update.modifiedCount;
            }
        }
    }
    return report;
}
async function run() {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const uri = process.env.MIGRATION_MONGO_URI;
    let url;
    try { url = new URL(uri); } catch { throw new Error('Set an explicit local MIGRATION_MONGO_URI; .env is never loaded.'); }
    const database = url.pathname.slice(1);
    if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname) || !/^[a-z0-9_]+_(migration|test|dev)$/.test(database)) throw new Error('Migration only permits an explicit local disposable/rehearsal database ending _migration, _test or _dev.');
    const apply = process.argv.includes('--apply');
    if (apply && process.env.MIGRATION_DATABASE_ACK !== database) throw new Error('For apply, MIGRATION_DATABASE_ACK must match the rehearsal database name.');
    await mongoose.connect(uri);
    try {
        if (apply) {
            const directory = path.resolve(__dirname, '../../.local-backups');
            await fs.mkdir(directory, { recursive: true });
            const snapshot = {};
            for (const name of ['violations', 'violationtypes']) snapshot[name] = await mongoose.connection.collection(name).find({}).toArray();
            const backup = path.join(directory, `money-before-${Date.now()}.ejson`);
            await fs.writeFile(backup, mongoose.mongo.BSON.EJSON.stringify(snapshot, { relaxed: false }), { flag: 'wx', mode: 0o600 });
            console.log('Local excluded EJSON backup created before applying the rehearsal migration.');
        }
        console.log(JSON.stringify(await migrateMoney({ dryRun: !apply }), null, 2));
    } finally { await mongoose.disconnect(); }
}
if (require.main === module) run().catch(() => { console.error('Migration failed; verify local rehearsal configuration and backup permissions.'); process.exitCode = 1; });
module.exports = { migrateMoney };

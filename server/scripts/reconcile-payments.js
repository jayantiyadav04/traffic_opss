// Run explicitly against a configured deployment; never loaded during startup.
const mongoose = require('mongoose');
const Payment = require('../src/models/Payment');
const { getDefaultAdapter } = require('../src/providers/paypal');
const { getPayment, retryWebhooks } = require('../src/services/paymentService');
async function run() {
    if (!process.env.MONGO_URI || process.env.RECONCILE_DATABASE_ACK !== 'reviewed-target') throw new Error('Explicit database and reviewed-target acknowledgement required.');
    const adapter = getDefaultAdapter();
    if (!adapter.configuration().available) throw new Error('Sandbox configuration is missing.');
    await mongoose.connect(process.env.MONGO_URI);
    try {
        let checked = 0;
        for (const payment of await Payment.find({ method: 'paypal', status: 'pending', provider_order_id: { $exists: true } }).limit(100)) {
            await getPayment({ id: String(payment._id), actor: { role: 'admin' }, adapter, reconcile: true }); checked++;
        }
        await retryWebhooks(adapter);
        console.log(JSON.stringify({ checked }));
    } finally { await mongoose.disconnect(); }
}
if (require.main === module) run().catch(() => { console.error('Reconciliation failed; inspect pending records through authorized tooling.'); process.exitCode = 1; });
module.exports = { run };

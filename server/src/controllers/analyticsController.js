const Violation = require('../models/Violation');
const { recordMoney } = require('../utils/money');
const AppError = require('../utils/AppError');
async function summarize(query, scope) {
    // Invalid legacy money raises an explicit error; currencies are never combined.
    const records = Violation.find(query).select('status amount_minor currency fine_amount schema_version').lean().cursor();
    const counts = { total: 0, unpaid: 0, paid: 0, disputed: 0 };
    const byCurrency = new Map();
    for await (const record of records) {
        if (!['unpaid', 'paid', 'disputed'].includes(record.status)) throw new AppError(503, 'RECORD_REVIEW_REQUIRED', 'A stored record requires review before totals can be displayed.');
        counts.total++;
        counts[record.status]++;
        let money;
        try { money = recordMoney(record); }
        catch { throw new AppError(503, 'MONEY_REVIEW_REQUIRED', 'Stored money requires review before totals can be displayed.'); }
        const total = byCurrency.get(money.currency) || { currency: money.currency, total_minor: 0, paid_minor: 0, unpaid_minor: 0, disputed_minor: 0 };
        total.total_minor += money.amount_minor;
        total[record.status + '_minor'] += money.amount_minor;
        if (![total.total_minor, total.paid_minor, total.unpaid_minor, total.disputed_minor].every(Number.isSafeInteger)) throw new AppError(503, 'TOTAL_OUT_OF_RANGE', 'Financial totals exceed the supported integer range.');
        byCurrency.set(money.currency, total);
    }
    return { scope, counts, totals: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)) };
}
const getDashboard = async (req, res) => {
    const query = req.user.role === 'citizen' ? { user: req.user._id, ownership_verified: true, schema_version: 2 } : req.user.role === 'officer' ? { officer: req.user._id } : {};
    res.json(await summarize(query, req.user.role === 'citizen' ? 'citizen-owned' : req.user.role === 'officer' ? 'officer-issued' : 'global'));
};
const getStats = async (req, res) => res.json(await summarize({}, 'global'));
const getViolationsByType = async (req, res) => res.json(await Violation.aggregate([
    { $group: { _id: '$violation_type', count: { $sum: 1 } } },
    { $lookup: { from: 'violationtypes', localField: '_id', foreignField: '_id', as: 'details' } },
    { $unwind: '$details' },
    { $project: { type_name: '$details.type_name', count: 1 } },
    { $sort: { type_name: 1 } },
]));
module.exports = { getDashboard, getStats, getViolationsByType };

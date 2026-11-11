export function money(record) {
    if (Number.isSafeInteger(record?.amount_minor) && typeof record?.currency === 'string') {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: record.currency }).format(record.amount_minor / 100);
    }
    if (Number.isFinite(record?.fine_amount)) {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(record.fine_amount);
    }
    if (Number.isFinite(record?.base_fine)) {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(record.base_fine);
    }
    return 'Amount unavailable';
}

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import API, { errorMessage } from '../api/axios';
import AuthContext from '../auth/AuthContext';
import Dialog from './Dialog';
import { ErrorNotice, Loading } from './Feedback';
import { money } from '../utils/money';

export default function PaymentDialog({ violation, onClose, onSettled }) {
    const { user } = useContext(AuthContext);
    const [config, setConfig] = useState({ loading: true });
    const [details, setDetails] = useState({ payment: null, receipt: null });
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(null);
    const [uncertain, setUncertain] = useState(false);
    const [cancelled, setCancelled] = useState(false);
    const [manual, setManual] = useState({ method: 'cash', reference: '', reason: '' });
    const lock = useRef(false);
    const keys = useRef({ order: crypto.randomUUID(), capture: crypto.randomUUID(), manual: crypto.randomUUID() });
    const lastManual = useRef(null);
    const paymentId = violation.payment_id || violation.collection_payment;
    const [receiptLoading, setReceiptLoading] = useState(Boolean(paymentId));
    const [receiptError, setReceiptError] = useState(null);
    const privileged = ['officer', 'admin'].includes(user.role);
    const completed = details.payment?.status === 'completed' || violation.status === 'paid';

    const applyResult = useCallback(data => {
        setDetails(data);
        setUncertain(data.payment?.status === 'pending');
        if (data.payment?.status === 'completed') onSettled(data);
    }, [onSettled]);

    const load = useCallback(async (signal) => {
        try {
            const { data } = await API.get('/payments/config', { signal });
            if (!signal?.aborted) setConfig({ ...data, loading: false });
        } catch (error) {
            if (!signal?.aborted) setConfig({ loading: false, error: errorMessage(error, 'Could not check sandbox payment availability.') });
        }
    }, []);

    const retrieveExisting = useCallback(signal => API.get(`/payments/${paymentId}`, { signal }).then(({ data }) => {
        if (!signal?.aborted) {
            applyResult(data);
            setReceiptError(null);
            setReceiptLoading(false);
        }
    }).catch(error => {
        if (!signal?.aborted) {
            setReceiptError(errorMessage(error, 'Could not retrieve the existing payment record. Retry before continuing.'));
            setReceiptLoading(false);
        }
    }), [paymentId, applyResult]);

    useEffect(() => {
        const controller = new AbortController();
        load(controller.signal);
        if (paymentId) retrieveExisting(controller.signal);
        return () => controller.abort();
    }, [load, paymentId, retrieveExisting]);

    const execute = async operation => {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setMessage(null);
        try { await operation(); }
        catch (error) {
            const unknown = !error.response || error.response.status >= 500;
            setUncertain(unknown);
            setMessage(unknown ? 'The payment result is not confirmed. Check its status or retry the same request; do not start another payment.' : errorMessage(error));
        } finally { lock.current = false; setBusy(false); }
    };

    const createOrder = () => execute(async () => {
        const { data } = await API.post('/payments/orders', { violation_id: violation._id }, { headers: { 'Idempotency-Key': keys.current.order } });
        setCancelled(false);
        applyResult(data);
    });
    const capture = () => execute(async () => {
        const { data } = await API.post(`/payments/orders/${details.payment.provider_order_id}/capture`, {}, { headers: { 'Idempotency-Key': keys.current.capture } });
        applyResult(data);
    });
    const refresh = () => execute(async () => {
        const id = details.payment?._id || paymentId;
        const { data } = await API.post(`/payments/${id}/reconcile`, {});
        applyResult(data);
    });
    const settleManual = event => {
        event.preventDefault();
        execute(async () => {
            const body = { method: manual.method, reference: manual.reference.trim(), reason: manual.reason.trim() };
            const fingerprint = JSON.stringify(body);
            if (lastManual.current && lastManual.current !== fingerprint) keys.current.manual = crypto.randomUUID();
            lastManual.current = fingerprint;
            const { data } = await API.put(`/violations/${violation._id}/pay`, body, { headers: { 'Idempotency-Key': keys.current.manual } });
            applyResult(data);
        });
    };
    const status = details.payment?.status || (violation.status === 'paid' ? 'completed' : 'not_started');
    const sandboxCurrencySupported = (config.currencies || ['USD']).includes(violation.currency);

    return <Dialog title={completed ? 'Payment receipt' : 'Resolve fine'} onClose={onClose} busy={busy}>
        <dl className="detail-list"><div><dt>Vehicle</dt><dd>{violation.vehicle_number}</dd></div>
            <div><dt>Fine</dt><dd>{money(violation)}</dd></div></dl>
        <p role="status" className="payment-status">Payment status: {status.replaceAll('_', ' ')}</p>
        {message && <ErrorNotice message={message} />}
        {receiptLoading ? <Loading>Loading payment record...</Loading> : receiptError ?
            <ErrorNotice message={receiptError} onRetry={() => { setReceiptLoading(true); setReceiptError(null); retrieveExisting(); }} /> :
            details.receipt ? <section className="receipt"><h3>Confirmed receipt</h3><dl className="detail-list">
            <div><dt>Receipt</dt><dd>{details.receipt.receipt_id}</dd></div>
            <div><dt>Amount</dt><dd>{money(details.receipt)}</dd></div>
            <div><dt>Method</dt><dd>{details.receipt.method}</dd></div>
            <div><dt>Reference</dt><dd>{details.receipt.reference}</dd></div>
            <div><dt>Settled at</dt><dd>{new Date(details.receipt.settled_at).toLocaleString()}</dd></div>
        </dl><p>This receipt is retrieved from the server&apos;s settlement record.</p></section> : completed ?
            <p>No server-backed receipt is available for this legacy record. Contact an administrator for review.</p> : <>
                {uncertain && <p className="feedback" role="status">A payment may be in progress. Its outcome must be verified before another collection.</p>}
                {details.payment && <div className="button-row">
                    {details.payment.approval_url && status === 'pending' && <a className="btn btn-primary" href={details.payment.approval_url} target="_blank" rel="noopener noreferrer">Approve in PayPal Sandbox</a>}
                    {details.payment.provider_order_id && status === 'pending' && <button className="btn btn-primary" disabled={busy} onClick={capture}>Check and capture payment</button>}
                    <button className="btn btn-outline" disabled={busy} onClick={refresh}>Check payment status</button>
                    {status === 'pending' && <button className="btn btn-ghost" disabled={busy} onClick={() => setCancelled(true)}>I cancelled approval</button>}
                </div>}
                {cancelled && <p role="status">Approval was dismissed in the browser. The fine is unpaid until the server confirms collection. Check payment status before retrying.</p>}
                {status === 'failed' && <p role="status">The payment failed. Its reservation remains under review; refresh status before using another method.</p>}
                {status === 'cancelled' && <p role="status">The server reports a cancelled payment. No successful collection is recorded.</p>}
                {!details.payment && <section className="form-section"><h3>PayPal Sandbox</h3>
                    {config.loading ? <Loading>Checking payment availability...</Loading> : config.error ? <ErrorNotice message={config.error} onRetry={() => load()} /> :
                        !config.available ? <p role="status">{config.reason || 'Sandbox payments are unavailable. Contact an officer for manual settlement.'}</p> :
                            !sandboxCurrencySupported ? <p role="status">Sandbox checkout is unavailable for {violation.currency || 'legacy INR'} records. The original currency is preserved.</p> :
                                <p>Use a synthetic sandbox account. Approving a checkout does not confirm payment until the server verifies it.</p>}
                    <button className="btn btn-primary" disabled={busy || config.loading || !config.available || !sandboxCurrencySupported || Boolean(config.error)} onClick={createOrder}>
                        {busy ? 'Checking payment...' : uncertain ? 'Retry the same checkout request' : 'Start sandbox checkout'}
                    </button>
                </section>}
                {privileged && !details.payment && <section className="form-section"><h3>Record manual payment</h3>
                    <p>Record a payment already collected through an approved method.</p>
                    <form onSubmit={settleManual}><fieldset disabled={busy || uncertain}>
                        <legend className="sr-only">Manual settlement</legend>
                        <label htmlFor="payment-method" className="form-label">Payment method</label>
                        <select id="payment-method" className="form-control" value={manual.method} onChange={event => setManual(value => ({ ...value, method: event.target.value }))}>
                            <option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option>
                        </select>
                        <label htmlFor="payment-reference" className="form-label">Payment reference</label>
                        <input id="payment-reference" className="form-control" required minLength={3} maxLength={120} value={manual.reference} onChange={event => setManual(value => ({ ...value, reference: event.target.value }))} />
                        <label htmlFor="payment-reason" className="form-label">Settlement reason</label>
                        <textarea id="payment-reason" className="form-control" required minLength={3} maxLength={200} value={manual.reason} onChange={event => setManual(value => ({ ...value, reason: event.target.value }))} />
                    </fieldset><button className="btn btn-primary" disabled={busy || (uncertain && !lastManual.current)}>{busy ? 'Recording...' : uncertain ? 'Retry the same manual settlement' : 'Record manual payment'}</button></form>
                </section>}
            </>}
    </Dialog>;
}

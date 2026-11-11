import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilePlus } from 'lucide-react';
import API, { errorMessage } from '../api/axios';
import { ErrorNotice, Loading } from '../components/Feedback';
import { money } from '../utils/money';

export default function RegisterViolation() {
    const [references, setReferences] = useState({ loading: true });
    const [email, setEmail] = useState('');
    const [lookup, setLookup] = useState({ loading: false, citizen: null, searched: false });
    const [verification, setVerification] = useState({ reference: '', confirmed: false, busy: false });
    const [form, setForm] = useState({ vehicle_number: '', violation_type: '', area: '', notes: '' });
    const [submission, setSubmission] = useState({ busy: false, error: null, success: false });
    const lookupGeneration = useRef(0);
    const submissionLock = useRef(false);

    const loadReferences = useCallback(async (signal) => {
        try {
            const [types, areas] = await Promise.all([API.get('/violations/types', { signal }), API.get('/violations/areas', { signal })]);
            if (!signal?.aborted) setReferences({ loading: false, types: types.data, areas: areas.data });
        } catch (error) {
            if (!signal?.aborted) setReferences({ loading: false, error: errorMessage(error, 'Could not load violation types and areas.') });
        }
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        loadReferences(controller.signal);
        return () => controller.abort();
    }, [loadReferences]);

    const findCitizen = async event => {
        event.preventDefault();
        const generation = ++lookupGeneration.current;
        setLookup({ loading: true, citizen: null, searched: false });
        setVerification({ reference: '', confirmed: false, busy: false });
        try {
            const { data } = await API.get('/auth/citizens', { params: { email: email.trim().toLowerCase() } });
            if (generation === lookupGeneration.current) setLookup({ loading: false, citizen: data[0] || null, searched: true });
        } catch (error) {
            if (generation === lookupGeneration.current) setLookup({ loading: false, citizen: null, error: errorMessage(error) });
        }
    };

    const verifyCitizen = async event => {
        event.preventDefault();
        if (!verification.confirmed || verification.busy) return;
        const generation = lookupGeneration.current;
        setVerification(value => ({ ...value, busy: true }));
        try {
            const { data } = await API.post(`/auth/citizens/${lookup.citizen._id}/verify`, { reference: verification.reference.trim() });
            if (generation === lookupGeneration.current) setLookup({ loading: false, citizen: data, searched: true });
        } catch (error) {
            if (generation === lookupGeneration.current) setLookup(value => ({ ...value, error: errorMessage(error) }));
        } finally { setVerification(value => ({ ...value, busy: false })); }
    };

    const submit = async event => {
        event.preventDefault();
        if (submissionLock.current || lookup.citizen?.onboarding_status !== 'verified') return;
        submissionLock.current = true;
        setSubmission({ busy: true, error: null, success: false });
        try {
            await API.post('/violations', { citizen_id: lookup.citizen._id, ...form });
            setSubmission({ busy: false, error: null, success: true });
        } catch (error) { setSubmission({ busy: false, error: errorMessage(error), success: false }); }
        finally { submissionLock.current = false; }
    };
    const change = event => setForm(value => ({ ...value, [event.target.name]: event.target.value }));
    const type = references.types?.find(value => value._id === form.violation_type);

    return <div className="container">
        <header className="page-header"><h1 className="page-title">Register violation</h1>
            <p className="page-subtitle">Link a verified citizen and record a policy-based fine.</p></header>
        {references.loading ? <Loading>Loading violation types and areas...</Loading> : references.error ?
            <ErrorNotice message={references.error} onRetry={() => { setReferences({ loading: true }); loadReferences(); }} /> :
            submission.success ? <div role="status" className="card feedback-success"><h2>Violation registered</h2>
                <p>The citizen is linked to their verified account.</p><Link className="btn btn-primary" to="/violations">View violations</Link></div> : <>
                <section className="card form-section"><h2>1. Find the citizen</h2>
                    <p>Use the account email checked during citizen onboarding. Names do not establish identity.</p>
                    <form onSubmit={findCitizen} className="lookup-form">
                        <div><label htmlFor="citizen-email" className="form-label">Citizen email</label>
                            <input id="citizen-email" className="form-control" type="email" maxLength={254} value={email} required
                                onChange={event => {
                                    lookupGeneration.current++;
                                    setEmail(event.target.value);
                                    setLookup({ loading: false, citizen: null, searched: false });
                                }} /></div>
                        <button className="btn btn-outline" disabled={lookup.loading || verification.busy}>{lookup.loading ? 'Finding citizen...' : 'Find citizen'}</button>
                    </form>
                    {lookup.error && <ErrorNotice message={lookup.error} />}
                    {lookup.searched && !lookup.citizen && <p role="status">No citizen account matches that email. Ask the citizen to register first.</p>}
                    {lookup.citizen && <div className="verified-citizen" role="status">
                        <strong>{lookup.citizen.full_name}</strong><p>{lookup.citizen.email}</p>
                        <p>Identity status: {lookup.citizen.onboarding_status}</p>
                    </div>}
                    {lookup.citizen && lookup.citizen.onboarding_status !== 'verified' && <form onSubmit={verifyCitizen} className="verification-form">
                        <h3>Verify citizen identity</h3>
                        <label htmlFor="verification-reference" className="form-label">Verification reference</label>
                        <input id="verification-reference" className="form-control" minLength={3} maxLength={120} required
                            value={verification.reference} disabled={verification.busy} onChange={event => setVerification(value => ({ ...value, reference: event.target.value }))} />
                        <label className="checkbox-label"><input type="checkbox" required checked={verification.confirmed} disabled={verification.busy}
                            onChange={event => setVerification(value => ({ ...value, confirmed: event.target.checked }))} />
                            I checked this citizen&apos;s identity against the reference.</label>
                        <button className="btn btn-outline" disabled={verification.busy || !verification.confirmed}>{verification.busy ? 'Verifying...' : 'Verify citizen'}</button>
                    </form>}
                </section>
                <section className="card form-section"><h2>2. Violation details</h2>
                    {submission.error && <ErrorNotice message={submission.error} />}
                    <form onSubmit={submit}>
                        <fieldset disabled={submission.busy || lookup.citizen?.onboarding_status !== 'verified'}>
                            <legend className="sr-only">Violation details</legend>
                            <div className="grid-cols-2">
                                <div className="form-group"><label className="form-label" htmlFor="vehicle-number">Vehicle number</label>
                                    <input id="vehicle-number" className="form-control" name="vehicle_number" minLength={3} maxLength={20} required
                                        value={form.vehicle_number} onChange={change} /></div>
                                <div className="form-group"><label className="form-label" htmlFor="violation-type">Violation type</label>
                                    <select id="violation-type" className="form-control" name="violation_type" required value={form.violation_type} onChange={change}>
                                        <option value="">Select a violation type</option>{references.types.map(value => <option key={value._id} value={value._id}>{value.type_name}</option>)}
                                    </select></div>
                                <div className="form-group"><label className="form-label" htmlFor="area">Area</label>
                                    <select id="area" className="form-control" name="area" required value={form.area} onChange={change}>
                                        <option value="">Select an area</option>{references.areas.map(value => <option key={value._id} value={value._id}>{value.area_name}</option>)}
                                    </select></div>
                                <div className="form-group"><p className="form-label">Approved fine</p><output aria-live="polite">{type ? money(type) : 'Choose a violation type'}</output>
                                    <p className="help-text">The server applies the approved policy amount.</p></div>
                            </div>
                            <div className="form-group"><label className="form-label" htmlFor="notes">Notes (optional)</label>
                                <textarea id="notes" className="form-control" name="notes" rows={3} maxLength={2000} value={form.notes} onChange={change} /></div>
                            <button className="btn btn-primary" type="submit"><FilePlus size={18} aria-hidden="true" />{submission.busy ? 'Registering...' : 'Register violation'}</button>
                        </fieldset>
                    </form>
                </section>
            </>}
    </div>;
}

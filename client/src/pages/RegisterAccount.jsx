import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import API, { errorMessage } from '../api/axios';
import { ErrorNotice } from '../components/Feedback';

export default function RegisterAccount() {
    const [form, setForm] = useState({ username: '', full_name: '', email: '', password: '' });
    const [state, setState] = useState({ busy: false, success: false, error: null });
    const lock = useRef(false);
    const change = event => setForm(value => ({ ...value, [event.target.name]: event.target.value }));
    const submit = async event => {
        event.preventDefault();
        if (lock.current) return;
        lock.current = true;
        setState({ busy: true, success: false, error: null });
        try {
            await API.post('/auth/register', { ...form, email: form.email.trim().toLowerCase() });
            setForm({ username: '', full_name: '', email: '', password: '' });
            setState({ busy: false, success: true, error: null });
        } catch (error) { setState({ busy: false, success: false, error: errorMessage(error, 'Could not create your citizen account.') }); }
        finally { lock.current = false; }
    };

    return <main className="account-page"><section className="card account-card"><h1 className="page-title">Create citizen account</h1>
        {state.success ? <div role="status"><h2>Your citizen account is ready</h2>
            <p>Sign in to access your records. An officer will verify your identity before assigning new violations to this account.</p>
            <Link className="btn btn-primary" to="/login">Sign in</Link></div> : <>
            <p className="page-subtitle">Create your own account. Officer and administrator accounts are provisioned by an administrator.</p>
            {state.error && <ErrorNotice message={state.error} />}
            <form onSubmit={submit}><fieldset disabled={state.busy}><legend className="sr-only">Citizen account details</legend>
                <div className="form-group"><label className="form-label" htmlFor="signup-name">Full name</label>
                    <input className="form-control" id="signup-name" name="full_name" autoComplete="name" maxLength={100} required value={form.full_name} onChange={change} /></div>
                <div className="form-group"><label className="form-label" htmlFor="signup-username">Username</label>
                    <input className="form-control" id="signup-username" name="username" autoComplete="username" minLength={3} maxLength={40} pattern="[A-Za-z0-9_]+" required value={form.username} onChange={change} aria-describedby="username-help" />
                    <p id="username-help" className="help-text">Use 3–40 letters, numbers, or underscores.</p></div>
                <div className="form-group"><label className="form-label" htmlFor="signup-email">Email address</label>
                    <input className="form-control" id="signup-email" name="email" type="email" autoComplete="email" maxLength={254} required value={form.email} onChange={change} /></div>
                <div className="form-group"><label className="form-label" htmlFor="signup-password">Password</label>
                    <input className="form-control" id="signup-password" name="password" type="password" autoComplete="new-password" minLength={10} maxLength={72} required value={form.password} onChange={change} aria-describedby="password-help" />
                    <p id="password-help" className="help-text">Use a unique passphrase of at least 10 characters.</p></div>
                <button className="btn btn-primary">{state.busy ? 'Creating account...' : 'Create citizen account'}</button>
            </fieldset></form>
            <p className="account-link">Already registered? <Link to="/login">Sign in</Link></p>
        </>}
    </section></main>;
}

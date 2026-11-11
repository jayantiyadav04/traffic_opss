import { useCallback, useContext, useEffect, useState } from 'react';
import { Shield, AlertTriangle, CheckCircle, FileWarning } from 'lucide-react';
import API, { errorMessage } from '../api/axios';
import AuthContext from '../auth/AuthContext';
import { ErrorNotice, Loading } from '../components/Feedback';
import { money } from '../utils/money';

const scopes = { citizen: 'Your records', officer: 'Issued by you', admin: 'All records' };
const cards = [
    { label: 'Total violations', key: 'total', Icon: Shield },
    { label: 'Unpaid cases', key: 'unpaid', Icon: AlertTriangle },
    { label: 'Paid cases', key: 'paid', Icon: CheckCircle },
    { label: 'Disputed cases', key: 'disputed', Icon: FileWarning },
];

export default function Dashboard() {
    const { user } = useContext(AuthContext);
    const [resource, setResource] = useState({ loading: true, data: null, error: null });
    const load = useCallback(signal => API.get('/analytics/dashboard', { signal }).then(({ data }) => {
        if (!signal?.aborted) setResource({ loading: false, data, error: null });
    }).catch(error => {
        if (!signal?.aborted) setResource({ loading: false, data: null, error: errorMessage(error) });
    }), []);
    useEffect(() => {
        const controller = new AbortController();
        load(controller.signal);
        return () => controller.abort();
    }, [load]);

    return <div className="container">
        <header className="page-header"><h1 className="page-title">Dashboard</h1>
            <p className="page-subtitle">Welcome back, {user.full_name}.</p>
            <p className="scope-label">{scopes[user.role]}</p>
        </header>
        {resource.loading ? <Loading>Loading your dashboard...</Loading> : resource.error ?
            <ErrorNotice message={resource.error} onRetry={() => { setResource({ loading: true }); load(); }} /> : <>
                <div className="grid-cols-4">
                    {cards.map(({ label, key, Icon }) => <article className="card-stat" key={key}>
                        <Icon aria-hidden="true" size={25} color="var(--primary)" />
                        <h2 className="stat-value">{resource.data.counts[key]}</h2><p>{label}</p>
                    </article>)}
                </div>
                <h2 className="section-title">Fine totals by currency</h2>
                {resource.data.totals.length === 0 ? <p>No fines in this scope yet.</p> :
                    <div className="grid-cols-2">{resource.data.totals.map(total => <article className="card" key={total.currency}>
                        <h3>{total.currency}</h3>
                        <dl className="detail-list">
                            <div><dt>Total fines</dt><dd>{money({ amount_minor: total.total_minor, currency: total.currency })}</dd></div>
                            <div><dt>Collected</dt><dd>{money({ amount_minor: total.paid_minor, currency: total.currency })}</dd></div>
                            <div><dt>Unpaid</dt><dd>{money({ amount_minor: total.unpaid_minor, currency: total.currency })}</dd></div>
                            <div><dt>Disputed</dt><dd>{money({ amount_minor: total.disputed_minor, currency: total.currency })}</dd></div>
                        </dl>
                    </article>)}</div>}
            </>}
    </div>;
}

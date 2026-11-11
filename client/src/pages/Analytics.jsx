import { useCallback, useEffect, useState } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, BarElement, CategoryScale, LinearScale } from 'chart.js';
import { Pie, Bar } from 'react-chartjs-2';
import API, { errorMessage } from '../api/axios';
import { ErrorNotice, Loading } from '../components/Feedback';
import { money } from '../utils/money';

ChartJS.register(ArcElement, Tooltip, Legend, BarElement, CategoryScale, LinearScale);
const colors = ['#10b981', '#ef4444', '#f59e0b'];

export default function Analytics() {
    const [resource, setResource] = useState({ loading: true });
    const load = useCallback(signal => Promise.all([API.get('/analytics/stats', { signal }), API.get('/analytics/by-type', { signal })])
        .then(([stats, types]) => {
            if (!signal?.aborted) setResource({ loading: false, stats: stats.data, types: types.data });
        }).catch(error => {
            if (!signal?.aborted) setResource({ loading: false, error: errorMessage(error, 'Administrative analytics could not be loaded.') });
        }), []);
    useEffect(() => {
        const controller = new AbortController();
        load(controller.signal);
        return () => controller.abort();
    }, [load]);
    const counts = resource.stats?.counts;

    return <div className="container"><header className="page-header"><h1 className="page-title">Analytics</h1>
        <p className="page-subtitle">Administrative reports across all records. Currency totals remain separate.</p></header>
        {resource.loading ? <Loading>Loading administrative analytics...</Loading> : resource.error ?
            <ErrorNotice message={resource.error} onRetry={() => { setResource({ loading: true }); load(); }} /> : <>
                <section className="card"><h2>Case counts</h2><dl className="detail-list">
                    <div><dt>Total violations</dt><dd>{counts.total}</dd></div><div><dt>Paid</dt><dd>{counts.paid}</dd></div>
                    <div><dt>Unpaid</dt><dd>{counts.unpaid}</dd></div><div><dt>Disputed</dt><dd>{counts.disputed}</dd></div>
                </dl></section>
                {counts.total === 0 ? <p className="feedback" role="status">No violations have been recorded.</p> : <div className="grid-cols-2" style={{ marginTop: '1.5rem' }}>
                    <figure className="card"><figcaption>Violation status (case counts)</figcaption><div style={{ height: 280 }}>
                        <Pie aria-hidden="true" data={{ labels: ['Paid', 'Unpaid', 'Disputed'], datasets: [{ data: [counts.paid, counts.unpaid, counts.disputed], backgroundColor: colors }] }}
                            options={{ responsive: true, maintainAspectRatio: false }} />
                    </div></figure>
                    <figure className="card"><figcaption>Violations by type</figcaption><div style={{ height: 280 }}>
                        <Bar aria-hidden="true" data={{ labels: resource.types.map(type => type.type_name), datasets: [{ label: 'Cases', data: resource.types.map(type => type.count), backgroundColor: '#6366f1' }] }}
                            options={{ responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }} />
                    </div></figure>
                </div>}
                <h2 className="section-title">Fine totals by currency</h2>
                <div className="grid-cols-2">{resource.stats.totals.map(total => <section className="card" key={total.currency}><h3>{total.currency}</h3>
                    <dl className="detail-list"><div><dt>Total fines</dt><dd>{money({ currency: total.currency, amount_minor: total.total_minor })}</dd></div>
                        <div><dt>Collected</dt><dd>{money({ currency: total.currency, amount_minor: total.paid_minor })}</dd></div>
                        <div><dt>Unpaid</dt><dd>{money({ currency: total.currency, amount_minor: total.unpaid_minor })}</dd></div>
                        <div><dt>Disputed</dt><dd>{money({ currency: total.currency, amount_minor: total.disputed_minor })}</dd></div></dl>
                </section>)}</div>
                <h2 className="section-title">Type counts</h2><div className="table-container scroll-table"><table className="table">
                    <thead><tr><th scope="col">Violation type</th><th scope="col">Cases</th></tr></thead>
                    <tbody>{resource.types.map(type => <tr key={type._id || type.type_name}><td>{type.type_name}</td><td>{type.count}</td></tr>)}</tbody>
                </table></div>
            </>}
    </div>;
}

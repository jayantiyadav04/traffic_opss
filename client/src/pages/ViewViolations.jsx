import { useCallback, useEffect, useState } from 'react';
import API, { errorMessage } from '../api/axios';
import { ErrorNotice, Loading } from '../components/Feedback';
import PaymentDialog from '../components/PaymentDialog';
import { money } from '../utils/money';

const blankFilters = { vehicle_number: '', status: '', date_from: '', date_to: '' };

function Records({ filters, cursor, onPage, onSelect, pageNumber, settlements }) {
    const [resource, setResource] = useState({ loading: true });
    const load = useCallback((signal) => {
        const params = { limit: 20 };
        if (cursor) params.cursor = cursor;
        for (const [key, value] of Object.entries(filters)) {
            if (value) params[key] = key.startsWith('date_') ? new Date(value).toISOString() : value;
        }
        return API.get('/violations', { params, signal }).then(({ data }) => {
            if (!signal?.aborted) setResource({ loading: false, data });
        }).catch(error => {
            if (!signal?.aborted) setResource({ loading: false, error: errorMessage(error, 'Could not load violations.') });
        });
    }, [filters, cursor]);
    useEffect(() => {
        const controller = new AbortController();
        load(controller.signal);
        return () => controller.abort();
    }, [load]);

    if (resource.loading) return <Loading />;
    if (resource.error) return <ErrorNotice message={resource.error} onRetry={() => { setResource({ loading: true }); load(); }} />;
    return <>
        {resource.data.items.length === 0 ? <div className="empty-state" role="status"><h2>No violations found</h2><p>No records match these filters.</p></div> :
            <div className="table-container scroll-table"><table className="table"><caption className="sr-only">Traffic violation records</caption>
                <thead><tr><th scope="col">Date</th><th scope="col">Vehicle</th><th scope="col">Citizen</th><th scope="col">Type</th>
                    <th scope="col">Fine</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
                <tbody>{resource.data.items.map(original => {
                    const settlement = settlements[original._id];
                    const record = settlement ? { ...original, status: 'paid', payment_id: settlement._id } : original;
                    return <tr key={record._id}>
                    <td>{new Date(record.violation_date || record.createdAt).toLocaleDateString()}</td><td>{record.vehicle_number}</td>
                    <td>{record.citizen?.full_name || record.user?.full_name || record.owner_name || 'Needs identity review'}</td>
                    <td>{record.violation_type?.type_name || 'Unavailable'}</td><td>{money(record)}</td>
                    <td><span className={`badge badge-${record.status}`}>{record.status}</span></td>
                    <td>{record.status === 'disputed' ? <span>Under review</span> :
                        <button className="btn btn-outline" onClick={() => onSelect(record)} aria-label={`${record.status === 'paid' ? 'View receipt' : 'Resolve fine'} for ${record.vehicle_number}`}>
                            {record.status === 'paid' ? 'View receipt' : 'Resolve fine'}
                        </button>}</td>
                </tr>; })}</tbody>
            </table></div>}
        <nav aria-label="Violation pages" className="pagination">
            <button className="btn btn-outline" disabled={pageNumber === 1} onClick={() => onPage('previous')}>Previous page</button>
            <p role="status">Page {pageNumber}</p>
            <button className="btn btn-outline" disabled={!resource.data.page.hasMore} onClick={() => onPage('next', resource.data.page.nextCursor)}>Next page</button>
        </nav>
    </>;
}

export default function ViewViolations() {
    const [draft, setDraft] = useState(blankFilters);
    const [navigation, setNavigation] = useState({ filters: blankFilters, cursors: [null], index: 0 });
    const [filterError, setFilterError] = useState(null);
    const [selected, setSelected] = useState(null);
    const [settlements, setSettlements] = useState({});
    const close = useCallback(() => setSelected(null), []);
    const settled = useCallback(data => {
        if (data.payment?.violation_id) setSettlements(value => ({ ...value, [data.payment.violation_id]: data.payment }));
    }, []);
    const change = event => setDraft(value => ({ ...value, [event.target.name]: event.target.value }));
    const apply = event => {
        event.preventDefault();
        if (draft.date_from && draft.date_to && new Date(draft.date_from) >= new Date(draft.date_to)) {
            setFilterError('The to date must be later than the from date.'); return;
        }
        setFilterError(null);
        setNavigation({ filters: { ...draft, vehicle_number: draft.vehicle_number.trim().toUpperCase() }, cursors: [null], index: 0 });
    };
    const onPage = (direction, cursor) => setNavigation(value => direction === 'previous' ? { ...value, index: value.index - 1 } :
        { ...value, cursors: [...value.cursors.slice(0, value.index + 1), cursor], index: value.index + 1 });

    return <div className="container"><header className="page-header"><h1 className="page-title">Violations</h1>
        <p className="page-subtitle">Search records, follow payment progress, and retrieve receipts.</p></header>
        <form className="card filters" onSubmit={apply}>
            <div><label htmlFor="filter-vehicle" className="form-label">Vehicle number</label>
                <input id="filter-vehicle" name="vehicle_number" className="form-control" maxLength={20} value={draft.vehicle_number} onChange={change} placeholder="Number starts with..." /></div>
            <div><label htmlFor="filter-status" className="form-label">Status</label>
                <select id="filter-status" name="status" className="form-control" value={draft.status} onChange={change}>
                    <option value="">All statuses</option><option value="unpaid">Unpaid</option><option value="paid">Paid</option><option value="disputed">Disputed</option></select></div>
            <div><label htmlFor="filter-from" className="form-label">From date</label>
                <input id="filter-from" type="date" name="date_from" className="form-control" value={draft.date_from} onChange={change} /></div>
            <div><label htmlFor="filter-to" className="form-label">To date</label>
                <input id="filter-to" type="date" name="date_to" className="form-control" value={draft.date_to} onChange={change} aria-describedby="date-help" /></div>
            <p className="help-text" id="date-help">Dates use UTC. From date is inclusive; to date is exclusive.</p>
            <div className="button-row"><button className="btn btn-primary">Apply filters</button>
                <button className="btn btn-ghost" type="button" onClick={() => {
                    setDraft(blankFilters); setFilterError(null); setNavigation({ filters: blankFilters, cursors: [null], index: 0 });
                }}>Reset filters</button></div>
        </form>
        {filterError && <ErrorNotice message={filterError} />}
        <Records key={JSON.stringify([navigation.filters, navigation.cursors[navigation.index]])} filters={navigation.filters}
            cursor={navigation.cursors[navigation.index]} onPage={onPage} onSelect={setSelected} pageNumber={navigation.index + 1} settlements={settlements} />
        {selected && <PaymentDialog violation={selected} onClose={close} onSettled={settled} />}
    </div>;
}

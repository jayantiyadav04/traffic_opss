import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import API from '../api/axios';
import AuthContext from '../auth/AuthContext';
import Dashboard from './Dashboard';

vi.mock('../api/axios', () => ({ default: { get: vi.fn() }, errorMessage: error => error.message || 'Could not load dashboard' }));
beforeEach(() => API.get.mockReset());
const result = { counts: { total: 2, paid: 1, unpaid: 1, disputed: 0 }, totals: [
    { currency: 'INR', total_minor: 10000, paid_minor: 0, unpaid_minor: 10000, disputed_minor: 0 },
    { currency: 'USD', total_minor: 500, paid_minor: 500, unpaid_minor: 0, disputed_minor: 0 },
] };

describe('scoped dashboard', () => {
    it.each([['citizen', 'Your records'], ['officer', 'Issued by you'], ['admin', 'All records']])('loads the scoped dashboard for %s', async (role, label) => {
        API.get.mockResolvedValue({ data: result });
        render(<AuthContext.Provider value={{ user: { role, full_name: 'Demo User' } }}><Dashboard /></AuthContext.Provider>);
        await screen.findByText('Fine totals by currency');
        expect(screen.getByText(label)).toBeInTheDocument();
        expect(API.get.mock.calls.every(([url]) => url === '/analytics/dashboard')).toBe(true);
        expect(screen.getByRole('heading', { name: 'INR' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'USD' })).toBeInTheDocument();
    });

    it('shows a retryable error without rendering invented totals', async () => {
        API.get.mockRejectedValueOnce(new Error('Dashboard service unavailable')).mockResolvedValueOnce({ data: result });
        render(<AuthContext.Provider value={{ user: { role: 'citizen', full_name: 'Demo User' } }}><Dashboard /></AuthContext.Provider>);
        expect(await screen.findByRole('alert')).toHaveTextContent('Dashboard service unavailable');
        expect(screen.queryByText('Total violations')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await screen.findByText('Total violations');
    });
});

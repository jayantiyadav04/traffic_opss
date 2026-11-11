import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import API from '../api/axios';
import AuthContext from '../auth/AuthContext';
import ViewViolations from './ViewViolations';

vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() }, errorMessage: error => error.message || 'Request failed' }));
beforeEach(() => API.get.mockReset());
const record = { _id: 'synthetic-v1', vehicle_number: 'DEMO101', citizen: { full_name: 'Demo Citizen' },
    violation_type: { type_name: 'Demo policy' }, amount_minor: 12500, currency: 'INR', status: 'unpaid', violation_date: '2026-01-01T12:00:00Z' };
const page = (items = [record], hasMore = false) => ({ data: { items, page: { limit: 20, nextCursor: hasMore ? 'opaque-cursor' : null, hasMore } } });
const renderList = () => render(<AuthContext.Provider value={{ user: { role: 'citizen' } }}><ViewViolations /></AuthContext.Provider>);

describe('server-filtered violation list', () => {
    it('sends normalized filters and resets pagination when filters change', async () => {
        API.get.mockResolvedValueOnce(page([record], true)).mockResolvedValueOnce(page()).mockResolvedValueOnce(page());
        renderList();
        await screen.findByText('DEMO101');
        await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
        await screen.findByText('Page 2');
        expect(API.get.mock.calls[1][1].params.cursor).toBe('opaque-cursor');
        await userEvent.type(screen.getByLabelText('Vehicle number'), 'demo');
        await userEvent.selectOptions(screen.getByLabelText('Status'), 'unpaid');
        await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
        await screen.findByText('Page 1');
        expect(API.get.mock.calls[2][1].params).toEqual({ limit: 20, vehicle_number: 'DEMO', status: 'unpaid' });
        expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    });

    it('represents API errors explicitly instead of an empty list', async () => {
        API.get.mockRejectedValueOnce(new Error('List unavailable'));
        renderList();
        expect(await screen.findByRole('alert')).toHaveTextContent('List unavailable');
        expect(screen.queryByText('No violations found')).not.toBeInTheDocument();
    });

    it('ignores an older response after a filter request supersedes it', async () => {
        let resolveOld;
        API.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(page([]));
        renderList();
        await userEvent.type(screen.getByLabelText('Vehicle number'), 'NEW');
        await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
        await screen.findByText('No violations found');
        await act(async () => resolveOld(page()));
        expect(screen.queryByText('DEMO101')).not.toBeInTheDocument();
        expect(API.get.mock.calls[0][1].signal.aborted).toBe(true);
    });

    it('opens an accessible payment dialog and restores focus on Escape', async () => {
        API.get.mockImplementation(url => url === '/payments/config' ? Promise.resolve({ data: { available: false, reason: 'Sandbox is not configured' } }) : Promise.resolve(page()));
        renderList();
        const trigger = await screen.findByRole('button', { name: 'Resolve fine for DEMO101' });
        await userEvent.click(trigger);
        const dialog = await screen.findByRole('dialog', { name: 'Resolve fine' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        await screen.findByText('Sandbox is not configured');
        expect(screen.getByRole('button', { name: 'Start sandbox checkout' })).toBeDisabled();
        await userEvent.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(trigger).toHaveFocus();
    });
});

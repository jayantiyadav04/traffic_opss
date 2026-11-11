import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import API from '../api/axios';
import AuthContext from '../auth/AuthContext';
import PaymentDialog from './PaymentDialog';

vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() }, errorMessage: error => error.message || 'Request failed' }));
const violation = { _id: 'synthetic-v1', vehicle_number: 'DEMO101', amount_minor: 500, currency: 'USD', status: 'unpaid' };
const pending = { _id: 'synthetic-p1', status: 'pending', amount_minor: 500, currency: 'USD', provider_order_id: 'SANDBOX-ORDER', approval_url: 'https://www.sandbox.paypal.com/checkoutnow?token=synthetic' };
const renderDialog = (record = violation, role = 'citizen', onSettled = vi.fn()) => render(<AuthContext.Provider value={{ user: { role } }}>
    <PaymentDialog violation={record} onClose={vi.fn()} onSettled={onSettled} /></AuthContext.Provider>);
beforeEach(() => {
    API.get.mockReset(); API.post.mockReset(); API.put.mockReset();
    API.get.mockResolvedValue({ data: { available: true, currencies: ['USD'] } });
});

describe('server-verified payment flow', () => {
    it('blocks new collection when an existing payment cannot be read and recovers through retry', async () => {
        let receiptRequests = 0;
        API.get.mockImplementation(url => {
            if (url === '/payments/config') return Promise.resolve({ data: { available: true, currencies: ['USD'] } });
            if (++receiptRequests === 1) return Promise.reject(new Error('Existing payment unavailable'));
            return Promise.resolve({ data: { payment: pending, receipt: null } });
        });
        renderDialog({ ...violation, payment_id: pending._id }, 'officer');
        expect(await screen.findByRole('alert')).toHaveTextContent('Existing payment unavailable');
        expect(screen.queryByRole('button', { name: 'Start sandbox checkout' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Record manual payment' })).not.toBeInTheDocument();
        expect(API.post).not.toHaveBeenCalled();
        expect(API.put).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await screen.findByRole('link', { name: 'Approve in PayPal Sandbox' });
        expect(receiptRequests).toBe(2);
    });

    it('preserves INR and disables unsupported sandbox checkout', async () => {
        renderDialog({ ...violation, currency: 'INR', amount_minor: 50000 });
        expect(await screen.findByText(/Sandbox checkout is unavailable for INR/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Start sandbox checkout' })).toBeDisabled();
        expect(API.post).not.toHaveBeenCalled();
    });

    it('does not treat browser approval or cancellation as a completed payment', async () => {
        API.post.mockResolvedValue({ data: { payment: pending, receipt: null } });
        const onSettled = vi.fn();
        renderDialog(violation, 'citizen', onSettled);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Start sandbox checkout' })).toBeEnabled());
        await userEvent.click(screen.getByRole('button', { name: 'Start sandbox checkout' }));
        expect(await screen.findByRole('link', { name: 'Approve in PayPal Sandbox' })).toHaveAttribute('rel', 'noopener noreferrer');
        await userEvent.click(screen.getByRole('button', { name: 'I cancelled approval' }));
        expect(screen.getByText(/Approval was dismissed/)).toBeInTheDocument();
        expect(onSettled).not.toHaveBeenCalled();
        expect(screen.queryByText('Confirmed receipt')).not.toBeInTheDocument();
    });

    it('retries an uncertain order with the same idempotency key and displays only a server receipt', async () => {
        API.post.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ data: { payment: pending, receipt: null } })
            .mockResolvedValueOnce({ data: { payment: { ...pending, status: 'completed' }, receipt: { receipt_id: 'DEMO-RECEIPT',
                amount_minor: 500, currency: 'USD', method: 'paypal', reference: 'DEMO-CAPTURE', settled_at: '2026-01-01T12:00:00Z' } } });
        const onSettled = vi.fn();
        renderDialog(violation, 'citizen', onSettled);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Start sandbox checkout' })).toBeEnabled());
        await userEvent.click(screen.getByRole('button', { name: 'Start sandbox checkout' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Retry the same checkout request' }));
        const firstKey = API.post.mock.calls[0][2].headers['Idempotency-Key'];
        expect(API.post.mock.calls[1][2].headers['Idempotency-Key']).toBe(firstKey);
        await userEvent.click(await screen.findByRole('button', { name: 'Check and capture payment' }));
        expect(await screen.findByText('Confirmed receipt')).toBeInTheDocument();
        expect(screen.getByText('DEMO-RECEIPT')).toBeInTheDocument();
        expect(onSettled).toHaveBeenCalledTimes(1);
    });

    it('records manual method/reference/reason without submitting a client amount', async () => {
        API.get.mockResolvedValue({ data: { available: false, reason: 'Sandbox unavailable' } });
        API.put.mockResolvedValue({ data: { payment: { ...pending, status: 'completed' }, receipt: { receipt_id: 'MANUAL-1', amount_minor: 500, currency: 'USD', method: 'cash', reference: 'DEMO-REF', settled_at: '2026-01-01T12:00:00Z' } } });
        renderDialog(violation, 'officer');
        await screen.findByText('Sandbox unavailable');
        await userEvent.type(screen.getByLabelText('Payment reference'), 'DEMO-REF');
        await userEvent.type(screen.getByLabelText('Settlement reason'), 'Synthetic collection');
        await userEvent.click(screen.getByRole('button', { name: 'Record manual payment' }));
        await screen.findByText('MANUAL-1');
        expect(API.put).toHaveBeenCalledWith('/violations/synthetic-v1/pay', { method: 'cash', reference: 'DEMO-REF', reason: 'Synthetic collection' },
            { headers: { 'Idempotency-Key': expect.any(String) } });
    });
});

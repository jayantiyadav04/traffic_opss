import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import API from '../api/axios';
import RegisterViolation from './RegisterViolation';

vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn() }, errorMessage: error => error.message || 'Request failed' }));
const citizen = { _id: 'synthetic-citizen', full_name: 'Demo Citizen', email: 'citizen@example.test', onboarding_status: 'verified' };
const type = { _id: 'synthetic-policy', type_name: 'Synthetic policy', amount_minor: 10000, currency: 'INR' };
beforeEach(() => {
    API.get.mockReset(); API.post.mockReset();
    API.get.mockImplementation(url => Promise.resolve({ data: url === '/violations/types' ? [type] : url === '/violations/areas' ? [{ _id: 'synthetic-area', area_name: 'Demo area' }] : [citizen] }));
});
const renderForm = () => render(<MemoryRouter><RegisterViolation /></MemoryRouter>);
async function lookupCitizen() {
    await userEvent.type(await screen.findByLabelText('Citizen email'), citizen.email);
    await userEvent.click(screen.getByRole('button', { name: 'Find citizen' }));
    await screen.findByText('Demo Citizen');
}
async function fillViolation() {
    await userEvent.type(screen.getByLabelText('Vehicle number'), 'DEMO101');
    await userEvent.selectOptions(screen.getByLabelText('Violation type'), type._id);
    await userEvent.selectOptions(screen.getByLabelText('Area'), 'synthetic-area');
}

describe('verified identity and authoritative fine form', () => {
    it('keeps issuance disabled until a citizen is verified and submits no client money/name', async () => {
        API.post.mockResolvedValue({ data: {} });
        renderForm();
        expect(await screen.findByRole('button', { name: 'Register violation' })).toBeDisabled();
        await lookupCitizen();
        expect(API.get).toHaveBeenCalledWith('/auth/citizens', { params: { email: citizen.email } });
        await fillViolation();
        await userEvent.click(screen.getByRole('button', { name: 'Register violation' }));
        await screen.findByRole('heading', { name: 'Violation registered' });
        expect(API.post).toHaveBeenCalledWith('/violations', {
            citizen_id: citizen._id, vehicle_number: 'DEMO101', violation_type: type._id, area: 'synthetic-area', notes: '',
        });
    });

    it('requires an explicit identity check and server verification before issuance', async () => {
        API.get.mockImplementation(url => Promise.resolve({ data: url === '/violations/types' ? [type] : url === '/violations/areas' ? [{ _id: 'synthetic-area', area_name: 'Demo area' }] : [{ ...citizen, onboarding_status: 'pending' }] }));
        API.post.mockResolvedValue({ data: citizen });
        renderForm(); await lookupCitizen();
        expect(screen.getByRole('button', { name: 'Register violation' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Verify citizen' })).toBeDisabled();
        await userEvent.type(screen.getByLabelText('Verification reference'), 'SYNTHETIC-VERIFICATION');
        await userEvent.click(screen.getByLabelText(/I checked this citizen/));
        await userEvent.click(screen.getByRole('button', { name: 'Verify citizen' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Register violation' })).toBeEnabled());
        expect(API.post).toHaveBeenCalledWith(`/auth/citizens/${citizen._id}/verify`, { reference: 'SYNTHETIC-VERIFICATION' });
    });

    it('shows reference API failure without a broken creation form', async () => {
        API.get.mockRejectedValue(new Error('Reference service unavailable'));
        renderForm();
        expect(await screen.findByRole('alert')).toHaveTextContent('Reference service unavailable');
        expect(screen.queryByRole('button', { name: 'Register violation' })).not.toBeInTheDocument();
    });

    it('prevents duplicate issuance while the request is pending', async () => {
        API.post.mockImplementation(() => new Promise(() => {}));
        renderForm(); await lookupCitizen(); await fillViolation();
        await userEvent.dblClick(screen.getByRole('button', { name: 'Register violation' }));
        expect(API.post).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Registering...' })).toBeDisabled();
    });
});

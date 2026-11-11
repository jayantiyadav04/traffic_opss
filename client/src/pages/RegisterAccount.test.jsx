import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import API from '../api/axios';
import RegisterAccount from './RegisterAccount';

vi.mock('../api/axios', () => ({ default: { post: vi.fn() }, errorMessage: error => error.message }));
beforeEach(() => { API.post.mockReset(); });
async function fillForm() {
    await userEvent.type(screen.getByLabelText('Full name'), 'Demo Citizen');
    await userEvent.type(screen.getByLabelText('Username'), 'demo_citizen');
    await userEvent.type(screen.getByLabelText('Email address'), 'Citizen@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'Synthetic-passphrase-42');
}

describe('citizen onboarding', () => {
    it('submits only citizen account fields and explains verification', async () => {
        API.post.mockResolvedValue({ data: { role: 'citizen' } });
        render(<MemoryRouter><RegisterAccount /></MemoryRouter>);
        await fillForm();
        await userEvent.click(screen.getByRole('button', { name: 'Create citizen account' }));
        await screen.findByRole('heading', { name: 'Your citizen account is ready' });
        const [path, body] = API.post.mock.calls[0];
        expect(path).toBe('/auth/register');
        expect(body.email).toBe('citizen@example.test');
        expect(Object.keys(body).sort()).toEqual(['email', 'full_name', 'password', 'username']);
        expect(screen.getByText(/officer will verify/)).toBeInTheDocument();
    });

    it('shows signup failure without claiming the account exists', async () => {
        API.post.mockRejectedValue(new Error('Account could not be created'));
        render(<MemoryRouter><RegisterAccount /></MemoryRouter>);
        await fillForm();
        await userEvent.click(screen.getByRole('button', { name: 'Create citizen account' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Account could not be created');
        expect(screen.queryByText('Your citizen account is ready')).not.toBeInTheDocument();
    });
});

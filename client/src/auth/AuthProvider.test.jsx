import { useContext } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthContext from './AuthContext';
import AuthProvider from './AuthProvider';
import API from '../api/axios';
import { SESSION_KEY } from './session';

vi.mock('../api/axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const session = { _id: 'synthetic-citizen', full_name: 'Demo Citizen', role: 'citizen', token: 'synthetic-session' };

function Consumer() {
    const { user, loading, logout, sessionError } = useContext(AuthContext);
    return <><p>{loading ? 'Checking session' : user?.full_name || 'Signed out'}</p>
        {sessionError && <p role="alert">{sessionError}</p>}
        <button onClick={() => logout()}>Sign out</button></>;
}

describe('session boundary', () => {
    it('survives malformed saved JSON and clears legacy persistent data', () => {
        sessionStorage.setItem(SESSION_KEY, '{invalid');
        localStorage.setItem('user', '{invalid');
        render(<AuthProvider><Consumer /></AuthProvider>);
        expect(screen.getByText('Signed out')).toBeInTheDocument();
        expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
        expect(localStorage.getItem('user')).toBeNull();
        expect(API.get).not.toHaveBeenCalled();
    });

    it('uses the revalidated server role instead of the saved claim', async () => {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, role: 'admin' }));
        API.get.mockResolvedValue({ data: { ...session, role: 'citizen' } });
        render(<AuthProvider><Consumer /></AuthProvider>);
        await screen.findByText('Demo Citizen');
        expect(API.get).toHaveBeenCalledWith('/auth/me', { signal: expect.any(AbortSignal) });
        expect(JSON.parse(sessionStorage.getItem(SESSION_KEY)).role).toBe('citizen');
    });

    it('clears rejected sessions and does not render saved identity', async () => {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        API.get.mockRejectedValue({ response: { status: 401 } });
        render(<AuthProvider><Consumer /></AuthProvider>);
        await screen.findByText('Signed out');
        expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    });

    it('shows a network verification failure explicitly', async () => {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        API.get.mockRejectedValue(new Error('offline'));
        render(<AuthProvider><Consumer /></AuthProvider>);
        expect(await screen.findByRole('alert')).toHaveTextContent('could not verify');
        expect(screen.queryByText('Demo Citizen')).not.toBeInTheDocument();
    });

    it('revokes logout server-side before clearing local state', async () => {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        API.get.mockResolvedValue({ data: session });
        API.post.mockResolvedValue({ data: {} });
        render(<AuthProvider><Consumer /></AuthProvider>);
        await screen.findByText('Demo Citizen');
        await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
        await waitFor(() => expect(screen.getByText('Signed out')).toBeInTheDocument());
        expect(API.post).toHaveBeenCalledWith('/auth/logout');
        expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    });
});

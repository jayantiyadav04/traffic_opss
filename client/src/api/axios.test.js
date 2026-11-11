import { describe, expect, it, vi } from 'vitest';
import API from './axios';
import { SESSION_KEY, SESSION_REJECTED } from '../auth/session';

describe('central API session handling', () => {
    it('does not crash requests when legacy storage is malformed', async () => {
        localStorage.setItem('user', '{invalid');
        sessionStorage.setItem(SESSION_KEY, '{invalid');
        const adapter = vi.fn(async config => ({ data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config }));
        await API.get('/example', { adapter });
        expect(adapter).toHaveBeenCalledTimes(1);
        expect(adapter.mock.calls[0][0].headers.Authorization).toBeUndefined();
        expect(localStorage.getItem('user')).toBeNull();
    });

    it('clears and announces a rejected session on protected API requests', async () => {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ _id: 'demo', role: 'citizen', token: 'synthetic-token' }));
        const rejected = vi.fn();
        window.addEventListener(SESSION_REJECTED, rejected);
        const adapter = async config => { throw { config, response: { status: 401 } }; };
        await expect(API.get('/violations', { adapter })).rejects.toMatchObject({ response: { status: 401 } });
        expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
        expect(rejected).toHaveBeenCalledTimes(1);
        window.removeEventListener(SESSION_REJECTED, rejected);
    });
});

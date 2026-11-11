import { useCallback, useEffect, useRef, useState } from 'react';
import API from '../api/axios';
import AuthContext from './AuthContext';
import { clearSession, expiresAt, readSession, SESSION_REJECTED, storeSession } from './session';

export default function AuthProvider({ children }) {
    const initialSession = useRef(readSession());
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(Boolean(initialSession.current));
    const [sessionError, setSessionError] = useState(null);
    const generation = useRef(0);

    const clear = useCallback(() => {
        generation.current++;
        clearSession();
        setUser(null);
        setLoading(false);
        setSessionError(null);
    }, []);

    const revalidate = useCallback(async (signal) => {
        const session = readSession();
        if (!session) return;
        const attempt = ++generation.current;
        try {
            const { data } = await API.get('/auth/me', { signal });
            if (signal?.aborted || attempt !== generation.current) return;
            const validated = storeSession({ ...data, token: session.token });
            setUser(validated);
            setSessionError(null);
        } catch (error) {
            if (signal?.aborted || attempt !== generation.current) return;
            setUser(null);
            if (error.response?.status === 401) clear();
            else setSessionError('We could not verify your session. Check your connection and retry.');
        } finally {
            if (!signal?.aborted && attempt === generation.current) setLoading(false);
        }
    }, [clear]);

    useEffect(() => {
        const controller = new AbortController();
        if (initialSession.current) revalidate(controller.signal);
        window.addEventListener(SESSION_REJECTED, clear);
        return () => { controller.abort(); window.removeEventListener(SESSION_REJECTED, clear); };
    }, [clear, revalidate]);

    useEffect(() => {
        const expiration = user && expiresAt(user.token);
        if (!expiration) return;
        const timer = setTimeout(clear, Math.max(0, expiration - Date.now()));
        return () => clearTimeout(timer);
    }, [user, clear]);

    const login = async (email, password) => {
        const { data } = await API.post('/auth/login', { email, password });
        generation.current++;
        const session = storeSession(data);
        setUser(session);
        setSessionError(null);
        return session;
    };

    const logout = async () => {
        try { await API.post('/auth/logout'); }
        finally { clear(); }
    };

    return <AuthContext.Provider value={{ user, login, logout, loading, sessionError, revalidate }}>{children}</AuthContext.Provider>;
}

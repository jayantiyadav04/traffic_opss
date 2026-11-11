export const SESSION_KEY = 'trafficOps.session';
export const SESSION_REJECTED = 'trafficops:session-rejected';

const roles = ['citizen', 'officer', 'admin'];

export function safeSession(value) {
    if (!value || typeof value !== 'object' || typeof value._id !== 'string' ||
        typeof value.token !== 'string' || !value.token || !roles.includes(value.role)) return null;
    return {
        _id: value._id, username: value.username, full_name: value.full_name,
        email: value.email, role: value.role, onboarding_status: value.onboarding_status,
        token: value.token,
    };
}

export function readSession() {
    try {
        // Previous versions persisted long-lived login data. Do not reuse it.
        localStorage.removeItem('user');
        const session = safeSession(JSON.parse(sessionStorage.getItem(SESSION_KEY)));
        if (!session) sessionStorage.removeItem(SESSION_KEY);
        return session;
    } catch {
        try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Storage may be unavailable. */ }
        return null;
    }
}

export function storeSession(value) {
    const session = safeSession(value);
    if (!session) throw new Error('The server returned an invalid session. Please sign in again.');
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
}

export function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem('user'); } catch { /* Already cleared in memory. */ }
}

export function expiresAt(token) {
    try {
        const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(encoded));
        return Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
    } catch { return null; }
}

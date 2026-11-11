import axios from 'axios';
import { clearSession, readSession, SESSION_REJECTED } from '../auth/session';

const API = axios.create({
    baseURL: '/api',
});

// Add a request interceptor to add token
API.interceptors.request.use(
    (config) => {
        const user = readSession();
        if (user && user.token) {
            config.headers.Authorization = `Bearer ${user.token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

API.interceptors.response.use(response => response, error => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
        clearSession();
        window.dispatchEvent(new Event(SESSION_REJECTED));
    }
    return Promise.reject(error);
});

export function errorMessage(error, fallback = 'The request could not be completed. Please retry.') {
    return error.response?.data?.error?.message || error.response?.data?.message || fallback;
}

export default API;

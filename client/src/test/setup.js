import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: query => ({ matches: false, media: query, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }),
});

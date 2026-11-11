# Traffic-Ops frontend

React/Vite role workflows for the Traffic-Ops MERN application. See the [root README](../README.md) for setup, synthetic accounts, replica-set requirements and the [OpenAPI contract](../openapi.json).

```sh
npm --prefix client ci
npm --prefix client run dev
npm --prefix client run lint
npm --prefix client run test:run
npm --prefix client run build
```

Vite proxies `/api` to the local backend on port 5000. The production build is `client/dist`; preview serves static frontend files and needs an API reverse proxy.

Routes: `/login`, `/register`, `/`, `/violations`, `/register-violation`, `/analytics`. API authorization is authoritative. Dashboard data is role-scoped, while officers retain operational violation access. Lists use server filters and signed cursors. Amounts display each record's explicit currency.

Authentication revalidates the short-lived bearer session against `/auth/me`, uses tab-scoped session storage, and clears expired sessions centrally. Logout revokes server sessions. No server secrets belong in Vite environment variables.

Payment dialogs use server-backed statuses and receipts, retain retry keys, and block competing collection while an outcome is uncertain. Sandbox availability and currency support are explicit. Browser approval/cancellation never establishes settlement.

Tests cover sessions, citizen signup, verified identity issuance, request failures, scoped dashboards, filtering, keyboard dialogs, payment uncertainty, and receipt recovery. Root Playwright journeys also exercise mobile navigation and real isolated HTTP/database role/receipt flows. Analytics is loaded as a separate route chunk; motion respects reduced-motion preferences.

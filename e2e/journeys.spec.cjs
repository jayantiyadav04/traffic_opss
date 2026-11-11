const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');

// These journeys exercise the browser against synthetic API fixtures. The backend
// integration suite separately verifies authorization and database persistence.
const objectId = (suffix) => String(suffix).padStart(24, '0');
const users = Object.fromEntries(['citizen', 'officer', 'admin'].map((role, index) => [role, {
  _id: objectId(index + 1), role, full_name: `Synthetic ${role}`, email: `${role}@example.test`,
}]));
const policy = { _id: objectId(10), type_name: 'Synthetic signal violation', amount_minor: 25000, currency: 'INR' };
const area = { _id: objectId(11), area_name: 'Synthetic sector', city: 'Test city' };
const violation = (index = 1) => ({
  _id: objectId(100 + index), vehicle_number: `TEST${index}`, owner_name: 'Synthetic citizen',
  user: users.citizen, officer: users.officer, violation_type: policy, area,
  status: 'unpaid', amount_minor: 25000, currency: 'INR', schema_version: 2,
  createdAt: '2026-01-01T10:00:00.000Z', violation_date: '2026-01-01T10:00:00.000Z',
});

const fixtureToken = (user) => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ id: user._id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
  'synthetic-browser-fixture',
].join('.');

async function fixtures(page, role, options = {}) {
  const requests = [];
  let dashboardFails = options.dashboardFails ?? false;
  let settled = false;
  const payment = (status = 'pending') => ({ _id: objectId(200), status, amount_minor: 25000, currency: 'USD', provider_order_id: 'SYNTHETIC-PAYPAL-ORDER' });
  const receipt = { receipt_id: 'SYNTHETIC-RECEIPT', amount_minor: 25000, currency: 'USD', method: 'paypal', reference: 'SYNTHETIC-CAPTURE', settled_at: '2026-01-01T10:00:00.000Z' };
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), method: request.method(), idempotencyKey: request.headers()['idempotency-key'] });
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (url.pathname === '/api/auth/login') return json({ ...users[role], token: fixtureToken(users[role]) });
    if (url.pathname === '/api/auth/me') return json(users[role]);
    if (url.pathname === '/api/auth/logout') return json({ message: 'Signed out' });
    if (url.pathname === '/api/analytics/dashboard') {
      if (dashboardFails) return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic dashboard outage' }, requestId: 'fixture-request' }, 503);
      return json({
        scope: { citizen: 'citizen_owned', officer: 'officer_issued', admin: 'global' }[role],
        counts: { total: 2, paid: 1, unpaid: 1, disputed: 0 },
        totals: [{ currency: 'INR', total_minor: 50000, paid_minor: 25000, unpaid_minor: 25000, disputed_minor: 0 }],
      });
    }
    if (url.pathname === '/api/violations/types') return json([policy]);
    if (url.pathname === '/api/violations/areas') return json([area]);
    if (url.pathname === '/api/violations' && request.method() === 'GET') {
      const later = url.searchParams.has('cursor');
      const record = { ...violation(later ? 2 : 1), ...(options.sandbox ? { currency: 'USD' } : {}), ...(settled ? { status: 'paid', payment_id: objectId(200) } : {}) };
      return json({ items: [record], page: { limit: 20, hasMore: !later, nextCursor: later ? null : 'fixture-page-two' } });
    }
    if (url.pathname === '/api/analytics/stats') return json({ totalViolations: 2, totalFines: 500, collectedFines: 250, pendingFines: 250, totals: [{ currency: 'INR', total_minor: 50000, paid_minor: 25000, unpaid_minor: 25000 }] });
    if (url.pathname === '/api/analytics/by-type') return json([{ _id: policy._id, type_name: policy.type_name, name: policy.type_name, count: 2 }]);
    if (url.pathname === '/api/payments/config') return json(options.sandbox ? { available: true, provider: 'paypal', currencies: ['USD'] } : { available: false, provider: 'paypal', reason: 'Sandbox configuration is unavailable.' });
    if (url.pathname === '/api/payments/orders' && request.method() === 'POST') return json({ payment: payment(), receipt: null }, 201);
    if (url.pathname === '/api/payments/orders/SYNTHETIC-PAYPAL-ORDER/capture') {
      settled = true;
      if (options.uncertainCapture) return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic uncertain provider outcome' } }, 503);
      return json({ payment: payment('completed'), receipt });
    }
    if (url.pathname === `/api/payments/${objectId(200)}/reconcile`) return json({ payment: payment(settled ? 'completed' : 'pending'), receipt: settled ? receipt : null });
    if (url.pathname === `/api/payments/${objectId(200)}`) return json({ payment: payment(settled ? 'completed' : 'pending'), receipt: settled ? receipt : null });
    return json({ error: { code: 'FIXTURE_ROUTE_MISSING', message: 'Unexpected synthetic API request' } }, 404);
  });
  return { requests, recoverDashboard() { dashboardFails = false; } };
}

async function signIn(page, role) {
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(users[role].email);
  await page.getByLabel('Password', { exact: true }).fill(randomUUID());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

for (const role of ['citizen', 'officer', 'admin']) {
  test(`${role} can sign in, reload a scoped dashboard, and open violations`, async ({ page }) => {
    const fixture = await fixtures(page, role);
    await signIn(page, role);
    await expect(page.getByText({ citizen: 'Your records', officer: 'Issued by you', admin: 'All records' }[role], { exact: false })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Violations', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Violations', exact: true })).toBeVisible();
    await expect(page.getByText('TEST1', { exact: true })).toBeVisible();
    if (role === 'citizen') {
      await expect(page.getByRole('link', { name: 'Register violation', exact: true })).toHaveCount(0);
      expect(fixture.requests.some((request) => request.path === '/api/analytics/stats')).toBe(false);
    }
  });
}

test('citizen route guard denies privileged routes', async ({ page }) => {
  await fixtures(page, 'citizen');
  await signIn(page, 'citizen');
  await page.goto('/register-violation');
  await expect(page.getByText(/access denied|permission/i)).toBeVisible();
});

test('dashboard outage shows an error and can be retried', async ({ page }) => {
  const fixture = await fixtures(page, 'officer', { dashboardFails: true });
  await signIn(page, 'officer');
  await expect(page.getByRole('alert')).toContainText(/dashboard|unable|failed/i);
  fixture.recoverDashboard();
  await page.getByRole('button', { name: /retry|try again/i }).click();
  await expect(page.getByText('Issued by you', { exact: false })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('server filters and page cursor reset when a filter changes', async ({ page }) => {
  const fixture = await fixtures(page, 'officer');
  await signIn(page, 'officer');
  await page.getByRole('link', { name: 'Violations', exact: true }).click();
  await expect(page.getByText('TEST1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByText('TEST2', { exact: true })).toBeVisible();
  await page.getByLabel('Vehicle number', { exact: true }).fill('TEST');
  await page.getByLabel('Status', { exact: true }).selectOption('unpaid');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByText('TEST1', { exact: true })).toBeVisible();
  const lastList = fixture.requests.filter((request) => request.path === '/api/violations').at(-1);
  expect(lastList.query.vehicle_number).toBe('TEST');
  expect(lastList.query.status).toBe('unpaid');
  expect(lastList.query.cursor).toBeUndefined();
});

test('mobile navigation opens by keyboard and dismisses with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtures(page, 'officer');
  await signIn(page, 'officer');
  const open = page.getByRole('button', { name: 'Open navigation', exact: true });
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Navigation', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Navigation', exact: true })).toHaveCount(0);
  await expect(open).toBeFocused();
});

test('malformed saved session returns to sign in safely', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('trafficOps.session', '{invalid-json');
    localStorage.setItem('user', '{invalid-json');
  });
  await page.goto('/violations');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});

test('sandbox fixture cancellation and uncertain capture remain unpaid until server reconciliation', async ({ page }) => {
  const fixture = await fixtures(page, 'citizen', { sandbox: true, uncertainCapture: true });
  await signIn(page, 'citizen');
  await page.getByRole('link', { name: 'Violations', exact: true }).click();
  await page.getByRole('button', { name: 'Resolve fine for TEST1', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Start sandbox checkout', exact: true }).click();
  await expect(dialog.getByText('Payment status: pending', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'I cancelled approval', exact: true }).click();
  await expect(dialog.getByText(/fine is unpaid until the server confirms collection/)).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Confirmed receipt', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Check and capture payment', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('payment result is not confirmed');
  await expect(dialog.getByRole('heading', { name: 'Confirmed receipt', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Check payment status', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Confirmed receipt', exact: true })).toBeVisible();
  await expect(dialog.getByText('SYNTHETIC-RECEIPT', { exact: true })).toBeVisible();
  const mutations = fixture.requests.filter(request => request.path.includes('/payments/orders') && request.method === 'POST');
  expect(mutations).toHaveLength(2);
  expect(mutations.every(request => request.idempotencyKey)).toBe(true);
});

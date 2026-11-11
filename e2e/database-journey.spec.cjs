const { test, expect } = require('@playwright/test');

// This journey uses the real Express API and a new disposable MongoDB replica set.
// It does not contact a payment provider or use any pre-existing database.
for (const role of ['citizen', 'officer', 'admin']) {
  test(`real API/database: ${role} session, scoped records, and logout`, async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email address', { exact: true }).fill(`${role}@e2e.example.test`);
    await page.getByLabel('Password', { exact: true }).fill(process.env.E2E_SYNTHETIC_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByText({ citizen: 'Your records', officer: 'Issued by you', admin: 'All records' }[role], { exact: false })).toBeVisible();
    await page.getByRole('link', { name: 'Violations', exact: true }).click();
    await expect(page.getByText('E2EOWN0001', { exact: true })).toBeVisible();
    if (role === 'citizen') {
      await expect(page.getByText('E2EOTHER01', { exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByText('E2EOTHER01', { exact: true })).toBeVisible();
    }
    await page.reload();
    await expect(page.getByText('E2EOWN0001', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /sign out|logout|log out/i }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await page.goto('/violations');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  });
}

test('real API/database: manual settlement produces a durable receipt', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('officer@e2e.example.test');
  await page.getByLabel('Password', { exact: true }).fill(process.env.E2E_SYNTHETIC_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Violations', exact: true }).click();
  await page.getByRole('button', { name: 'Resolve fine for E2EOWN0001', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Payment reference', { exact: true }).fill('SYNTHETIC-E2E-REFERENCE');
  await dialog.getByLabel('Settlement reason', { exact: true }).fill('Synthetic browser settlement verification');
  await dialog.getByRole('button', { name: 'Record manual payment', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Confirmed receipt', exact: true })).toBeVisible();
  await expect(dialog.getByText('SYNTHETIC-E2E-REFERENCE', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'View receipt for E2EOWN0001', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirmed receipt', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('SYNTHETIC-E2E-REFERENCE', { exact: true })).toBeVisible();
});

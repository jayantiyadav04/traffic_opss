const { defineConfig, devices } = require('@playwright/test');
const { randomBytes } = require('node:crypto');

// Runtime-only synthetic credentials are shared with the disposable backend.
process.env.E2E_SYNTHETIC_PASSWORD ||= randomBytes(24).toString('hex');

module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    reducedMotion: 'reduce',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [{
    command: 'node e2e/server.cjs',
    url: 'http://127.0.0.1:5000/api/health/ready',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { E2E_SYNTHETIC_PASSWORD: process.env.E2E_SYNTHETIC_PASSWORD },
  }, {
    command: 'npm --prefix client run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30_000,
  }],
});

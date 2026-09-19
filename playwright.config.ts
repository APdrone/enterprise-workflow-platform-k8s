import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30 * 1000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run dev:api',
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command: 'npm run dev:notification',
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command: 'npm run dev:audit',
      port: 3002,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command: 'npm run dev:host',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
});

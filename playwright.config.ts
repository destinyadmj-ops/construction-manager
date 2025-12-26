import { defineConfig, devices } from '@playwright/test';

const host = '127.0.0.1';
const port = Number(process.env.PW_PORT ?? process.env.PORT ?? 3000);
const baseURL = `http://${host}:${Number.isFinite(port) ? port : 3000}`;

const ps = process.platform === 'win32' ? 'powershell' : 'pwsh';
const psArgs = process.platform === 'win32' ? '-NoProfile -ExecutionPolicy Bypass' : '-NoProfile';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `${ps} ${psArgs} -File scripts/pw-devserver.ps1 -BindHost ${host} -Port ${Number.isFinite(port) ? port : 3000}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});

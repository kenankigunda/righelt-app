// Run through resources:run. Fresh browser contexts keep certificate checks on.
import { chromium, firefox, webkit } from '@playwright/test';
import { browserLaunchOptions } from './playwright-launch-options.mjs';
import { localHttpsEnvironment, verifyLocalHttpsUrl } from './local-https.mjs';
import { readFileSync } from 'node:fs';

const url = process.argv[2];
if (!url) throw Error('Usage: pnpm check:https https://localhost:PORT');
const env = localHttpsEnvironment({ cwd: process.cwd() });
await verifyLocalHttpsUrl(url, readFileSync(env.WRANGLER_HTTPS_CERT_PATH));
let failed = false;
for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  let browser;
  try {
    browser = await type.launch(browserLaunchOptions(name));
    const page = await browser.newPage({ ignoreHTTPSErrors: false });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`${name}: trusted HTTPS navigation passed`);
  } catch (error) {
    failed = true;
    console.error(`${name}: ${error.message}`);
  } finally { await browser?.close(); }
}
if (failed) process.exitCode = 1;

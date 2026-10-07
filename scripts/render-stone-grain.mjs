// Rebuild the static tile after changing stone-grain.svg. Run through resources:run.
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
const source = new URL('../apps/web/assets/stone-grain.svg', import.meta.url);
const output = fileURLToPath(new URL('../apps/web/assets/stone-grain.webp', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'righelt-grain-'));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 192, height: 192 }, deviceScaleFactor: 1 });
  await page.goto(`data:image/svg+xml;base64,${(await readFile(source)).toString('base64')}`);
  const png = join(temp, 'grain.png');
  await page.screenshot({ path: png, omitBackground: true });
  execFileSync('cwebp', ['-lossless', '-exact', png, '-o', output], { stdio: 'inherit' });
} finally {
  await browser.close();
  await rm(temp, { recursive: true, force: true });
}

import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from '@playwright/test';
import {viewports} from './scripts/validation/model.mjs';
const harness=fileURLToPath(new URL('.',import.meta.url));
export default defineConfig({
  testDir:'./validation-account-e2e', workers:1, fullyParallel:false,
  timeout:120000, expect:{timeout:15000},
  outputDir:process.env.PLAYWRIGHT_OUTPUT_DIR||'test-results/validation-account',
  reporter:[['list'],['./scripts/validation/reporter.mjs']],
  use:{baseURL:'https://127.0.0.1:9988',ignoreHTTPSErrors:true,headless:true,trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:viewports.map(({name,width,height,...input})=>({name,use:{viewport:{width,height},...input}})),
  webServer:{command:`node ${JSON.stringify(path.join(harness,'scripts/validation/account-stack.mjs'))}`,
    cwd:process.env.RIGHELT_VALIDATION_TARGET_ROOT||process.cwd(),
    url:'https://127.0.0.1:9988',ignoreHTTPSErrors:true,reuseExistingServer:false,
    timeout:180000,gracefulShutdown:{signal:'SIGTERM',timeout:15000},stdout:'pipe',stderr:'pipe'},
});

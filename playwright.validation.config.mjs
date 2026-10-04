import path from 'node:path';
import {defineConfig} from '@playwright/test';
import {selectedViewports,visualPolicy} from './scripts/validation/visual-policy.mjs';
export default defineConfig({
 testDir:'./validation-e2e',workers:1,fullyParallel:false,timeout:90_000,expect:{timeout:15_000},
 outputDir:process.env.PLAYWRIGHT_OUTPUT_DIR||'test-results/validation-browser',
 reporter:[['list'],['./scripts/validation/reporter.mjs']],
 use:{baseURL:`http://127.0.0.1:${process.env.RIGHELT_E2E_WEB_PORT||9888}`,headless:true,trace:{mode:'retain-on-failure',screenshots:visualPolicy().mode!=='none'},screenshot:visualPolicy().mode==='none'?'off':'only-on-failure'},
 projects:selectedViewports().map(({name,width,height,...input})=>({name,use:{viewport:{width,height},...input}})),
 webServer:{command:'node scripts/e2e-stack.mjs',cwd:process.env.RIGHELT_VALIDATION_TARGET_ROOT||process.cwd(),url:`http://127.0.0.1:${process.env.RIGHELT_E2E_WEB_PORT||9888}`,reuseExistingServer:false,timeout:180_000,gracefulShutdown:{signal:'SIGTERM',timeout:15_000},stdout:'pipe',stderr:'pipe'},
});

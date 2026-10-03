import {defineConfig} from '@playwright/test';
import {viewports} from './scripts/validation/model.mjs';
export default defineConfig({
 testDir:'./validation-e2e',workers:1,fullyParallel:false,timeout:90_000,expect:{timeout:15_000},
 outputDir:process.env.PLAYWRIGHT_OUTPUT_DIR||'test-results/validation-browser',
 reporter:[['list'],['./scripts/validation/reporter.mjs']],
 use:{baseURL:`http://127.0.0.1:${process.env.RIGHELT_E2E_WEB_PORT||9888}`,headless:true,trace:'retain-on-failure',screenshot:'only-on-failure'},
 projects:viewports.map(({name,width,height,...input})=>({name,use:{viewport:{width,height},...input}})),
 webServer:{command:'node scripts/e2e-stack.mjs',url:`http://127.0.0.1:${process.env.RIGHELT_E2E_WEB_PORT||9888}`,reuseExistingServer:false,timeout:180_000,stdout:'pipe',stderr:'pipe'},
});

import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const localBrowser='/srv/demo/qa/browser-cache/browsers/chrome-154.0.8037.57/chrome';

export default defineConfig({
 testDir:'./tests/av8',
 testMatch:'workflow.spec.ts',
 workers:1,
 retries:0,
 timeout:120_000,
 expect:{timeout:15_000},
 outputDir:'test-results/av8/artifacts',
 reporter:[['list']],
 use:{
  baseURL:process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:8180',
  actionTimeout:15_000,
  navigationTimeout:30_000,
  viewport:{width:1440,height:1000},
  launchOptions:{executablePath:existsSync(localBrowser)?localBrowser:undefined,args:['--no-sandbox']},
  screenshot:'only-on-failure',
  trace:'retain-on-failure',
 },
});

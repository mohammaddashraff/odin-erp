import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
 testDir:'./tests/administration',workers:1,retries:0,timeout:120000,expect:{timeout:15000},
 outputDir:'/tmp/av8-administration-qa/artifacts',reporter:[['list']],
 use:{baseURL:'http://127.0.0.1:8180',viewport:{width:1440,height:1000},actionTimeout:15000,navigationTimeout:30000,
 launchOptions:{executablePath:resolve('../qa/browser-cache/browsers/chrome-154.0.8037.57/chrome'),args:['--no-sandbox']},trace:'retain-on-failure',screenshot:'only-on-failure'},
});

import {defineConfig} from '@playwright/test';
const evidence=process.env.REVIEW_EVIDENCE_DIR||'/workspace/odin-ui-remediation-evidence';
export default defineConfig({
 testDir:'./tests/remediation',testMatch:'*.spec.ts',workers:1,timeout:120000,expect:{timeout:10000},
 outputDir:evidence+'/artifacts',
 reporter:[['list'],['json',{outputFile:evidence+'/browser-results.json'}]],
 use:{baseURL:'http://127.0.0.1:8180',viewport:{width:1440,height:900},launchOptions:{executablePath:'/usr/bin/chromium',args:['--no-sandbox']},screenshot:'only-on-failure',trace:'retain-on-failure'}
});

import configuration from './playwright.config';
if (!process.env.STAGING_BASE_URL) throw new Error('Set STAGING_BASE_URL to an explicitly authorized isolated staging environment.');
export default {...configuration, testDir:'./tests/e2e'};

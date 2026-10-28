import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import pg from 'pg';
const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const [kind, command, ...args] = process.argv.slice(2);
if (!['dev','test'].includes(kind) || !command) throw new Error('Usage: node scripts/av8/run.mjs dev|test COMMAND [ARGS...]');
const env = { ...process.env };
for (const k of Object.keys(env)) if (/^(DATABASE|POSTGRES|ODIN|NEXT_PUBLIC|API_|AV8_|SMTP|MAIL|TWILIO|REDIS|QUEUE)/.test(k)) delete env[k];
Object.assign(env, dotenv.parse(fs.readFileSync(path.join(root, '.av8', `${kind}.env`))), {AV8_ROOT:root});
for (const key of ['DATABASE_URL','DATABASE_ADMIN_URL']) {
  const url = new URL(env[key]);
  if (url.hostname !== '127.0.0.1' || url.pathname !== `/av8_${kind}` || url.port !== (kind === 'dev' ? '5548' : '5549')
      || url.username !== (key === 'DATABASE_URL' ? 'av8_runtime':'av8_owner')) throw new Error('AV8 connection identity mismatch');
}
if (env.AV8_OUTBOUND !== 'disabled' || env.AV8_JOBS !== 'disabled') throw new Error('AV8 outbound services must be disabled');
const client = new pg.Client({connectionString:env.DATABASE_ADMIN_URL});
await client.connect();
const result = await client.query('SELECT current_database() AS db, resource FROM av8_guard.av8_environment_identity');
await client.end();
if (result.rows.length !== 1 || result.rows[0].db !== `av8_${kind}` || result.rows[0].resource !== `av8-erp-${kind}`) throw new Error('Database resource marker mismatch');
env.PATH = `${root}/.av8/bin:${root}/node_modules/.bin:${env.PATH}`;
env.NODE_OPTIONS = '--max-old-space-size=1024';
if(args.includes('build')) env.NODE_ENV = 'production';
const resultProcess = spawnSync(command, args, {cwd:root, env, stdio:'inherit'});
if (resultProcess.error) throw resultProcess.error;
process.exit(resultProcess.status ?? 1);

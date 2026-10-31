/** Provision only fresh, isolated local AV8 PostgreSQL clusters; never attach an existing database. */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const bin = process.env.AV8_PG_BIN;
if (!bin || !path.isAbsolute(bin)) throw new Error('Set AV8_PG_BIN to the installed PostgreSQL 17 bin directory.');
if (!process.argv.includes('--create')) throw new Error('Pass --create to provision fresh local test resources.');
const privateRoot = path.join(root, '.av8');
fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
const secret = () => randomBytes(32).toString('hex');
function run(executable, args, input, env = {}) {
  const result = spawnSync(path.join(bin, executable), args, { input, encoding: 'utf8', env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`${executable} failed; private diagnostics withheld. No unrelated resources were changed.`);
  return result.stdout;
}
async function ensureFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) => reject(new Error(error.code === 'EADDRINUSE' ? `Port ${port} is occupied; refusing to attach or stop its owner.` : `Cannot bind loopback:${port}: ${error.code}; no resource was changed.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
for (const [kind, port] of [['dev', 5548], ['test', 5549]]) {
  const envFile = path.join(privateRoot, `${kind}.env`);
  const data = path.join(privateRoot, `native-${kind}`);
  if (fs.existsSync(envFile) || fs.existsSync(data)) throw new Error(`${kind} already has configuration/data; refusing to replace it. Use pg_ctl with its original configuration to resume.`);
  await ensureFree(port);
  const owner = secret(), runtime = secret(), passwordFile = path.join(privateRoot, `${kind}-init-password`);
  fs.writeFileSync(passwordFile, owner, { mode: 0o600 });
  try { run('initdb', ['-D', data, '-U', 'av8_owner', '--pwfile', passwordFile, '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale=C']); }
  finally { fs.rmSync(passwordFile, { force: true }); }
  fs.appendFileSync(path.join(data, 'postgresql.conf'), `\nlisten_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = '${data.replaceAll("'", "''")}'\nmax_connections = 40\nshared_buffers = '64MB'\n`);
  run('pg_ctl', ['-D', data, '-l', path.join(privateRoot, `postgres-${kind}.log`), '-w', 'start']);
  const pgEnv = { PGPASSWORD: owner };
  run('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'av8_owner', `av8_${kind}`], undefined, pgEnv);
  run('psql', ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'av8_owner', '-d', `av8_${kind}`, '-v', 'ON_ERROR_STOP=1'], `CREATE ROLE av8_runtime LOGIN PASSWORD '${runtime}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT; CREATE SCHEMA av8_guard; CREATE TABLE av8_guard.av8_environment_identity(resource text PRIMARY KEY); GRANT USAGE ON SCHEMA av8_guard TO av8_runtime; GRANT SELECT ON av8_guard.av8_environment_identity TO av8_runtime; INSERT INTO av8_guard.av8_environment_identity VALUES ('av8-erp-${kind}'); REVOKE ALL ON DATABASE av8_${kind} FROM PUBLIC; GRANT CONNECT ON DATABASE av8_${kind} TO av8_runtime;`, pgEnv);
  const config = { AV8_ENV: kind, AV8_OUTBOUND: 'disabled', AV8_JOBS: 'disabled', DATABASE_ADMIN_URL: `postgresql://av8_owner:${owner}@127.0.0.1:${port}/av8_${kind}`, DATABASE_URL: `postgresql://av8_runtime:${runtime}@127.0.0.1:${port}/av8_${kind}`, API_PORT: '8181', API_ORIGIN: 'http://127.0.0.1:8181', ODIN_WEB_ORIGIN: 'http://127.0.0.1:8180', ODIN_ALLOWED_ORIGINS: 'http://127.0.0.1:8180,http://localhost:8180', ODIN_TOKEN_SECRET: secret(), ODIN_MFA_ENCRYPTION_KEY: secret(), ODIN_REQUIRE_PRIVILEGED_MFA: 'false', ODIN_ALLOW_SHARED_DEMO_LOGINS: 'false', NEXT_PUBLIC_ODIN_DEMO_MODE: 'false', ODIN_UI_BUILD_DIR: '.next-av8', NODE_ENV: 'development', AV8_BOOTSTRAP_PASSWORD: secret() };
  fs.writeFileSync(envFile, Object.entries(config).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  console.log(`${kind}: created isolated native PostgreSQL on loopback:${port}; credentials saved privately.`);
}

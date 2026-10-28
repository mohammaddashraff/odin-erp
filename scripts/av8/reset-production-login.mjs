import { hash } from 'bcryptjs';
import pg from 'pg';

if (process.argv[2] !== '--confirm-admin-password-reset') throw new Error('Explicit confirmation argument required');
if (process.env.AV8_ENV !== 'production' || process.env.AV8_SIMPLE_LOGIN !== 'true') throw new Error('The verified simple-login production environment is required');

const db=new pg.Client({connectionString:process.env.DATABASE_ADMIN_URL});
await db.connect();
try {
  await db.query('BEGIN');
  const selected=await db.query(`SELECT u.id, u.tenant_id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.email=$1 AND u.active=true AND r.key='super_admin' FOR UPDATE`,['admin@av8.local']);
  if(selected.rowCount!==1)throw new Error('Expected exactly one active AV8 administrator');
  const {id,tenant_id:tenantId}=selected.rows[0];
  const passwordHash=await hash('password',12);
  await db.query(`UPDATE users SET password_hash=$1, mfa_enabled=false, mfa_secret_encrypted=NULL, mfa_recovery_hashes='[]'::jsonb, mfa_enrolled_at=NULL, mfa_required=false, auth_version=auth_version+1 WHERE id=$2`,[passwordHash,id]);
  await db.query(`UPDATE refresh_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,[id]);
  await db.query(`INSERT INTO audit_events (tenant_id, user_id, action, entity_type, entity_id, new_values, created_at) VALUES ($1,$2,'ADMIN_SIMPLE_LOGIN_RESET','AUTH_SECURITY',$3,$4::jsonb,now())`,[tenantId,id,String(id),JSON.stringify({reason:'Account owner requested password-only login and MFA reset',mfaEnabled:false})]);
  await db.query('COMMIT');
  console.log(JSON.stringify({account:'admin@av8.local',passwordChanged:true,mfaReset:true,sessionsRevoked:true}));
}catch(error){await db.query('ROLLBACK').catch(()=>undefined);throw error;}finally{await db.end();}

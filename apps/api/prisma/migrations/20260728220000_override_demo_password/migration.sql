-- Keep all existing role-based demo profiles aligned with the shared demo password.
UPDATE "users"
SET "password_hash" = '$2b$12$HU2j6QBiUPzMCy770NmqGu.UCOQp..kTS.Qc7zwyrHsArj5tCySQG'
WHERE "email" IN (
  'admin@odin.demo',
  'cfo@odin.demo',
  'finance@odin.demo',
  'accountant@odin.demo',
  'auditor@odin.demo',
  'sales@odin.demo',
  'purchasing@odin.demo',
  'warehouse@odin.demo',
  'cashier@odin.demo'
);

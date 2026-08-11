import { normalizeDatabaseUrl } from './database-url';

describe('normalizeDatabaseUrl', () => {
  it('adds a UTC PostgreSQL session option to a plain connection URL', () => {
    expect(normalizeDatabaseUrl('postgresql://odin:secret@db.example:5432/odin'))
      .toBe('postgresql://odin:secret@db.example:5432/odin?options=-c%20TimeZone%3DUTC');
  });

  it('preserves query options, strengthens TLS, and does not duplicate UTC', () => {
    const normalized = normalizeDatabaseUrl('postgresql://odin@db.example/odin?schema=public&sslmode=require&options=-c%20statement_timeout%3D5000');
    expect(normalized).toBe('postgresql://odin@db.example/odin?schema=public&sslmode=verify-full&options=-c%20statement_timeout%3D5000%20-c%20TimeZone%3DUTC');
    expect(normalizeDatabaseUrl(normalized)).toBe(normalized);
  });

  it('does not rewrite literal plus characters outside the options parameter', () => {
    expect(normalizeDatabaseUrl('postgresql://odin:pa+ss@db.example/odin?application_name=odin+worker'))
      .toBe('postgresql://odin:pa+ss@db.example/odin?application_name=odin+worker&options=-c%20TimeZone%3DUTC');
  });
});

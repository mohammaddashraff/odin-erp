export function enforceTlsVerification(databaseUrl: string): string {
  return databaseUrl.replace(
    /([?&])sslmode=(?:prefer|require|verify-ca)(?=(&|$))/gi,
    '$1sslmode=verify-full',
  );
}

/**
 * Prisma's PostgreSQL adapter treats timestamp text as UTC. PostgreSQL emits
 * timestamptz values in the session timezone, so a non-UTC database/session
 * can otherwise move effective-access boundaries by the local UTC offset.
 * Keep every application, migration, and seed connection on UTC explicitly.
 */
export function normalizeDatabaseUrl(databaseUrl: string): string {
  const tlsVerified = enforceTlsVerification(databaseUrl);
  const parsed = new URL(tlsVerified);
  const options = parsed.searchParams.get('options')?.trim() || '';
  if (!/(?:^|\s)-c\s*timezone\s*=\s*utc(?:\s|$)/i.test(options)) {
    parsed.searchParams.set('options', `${options}${options ? ' ' : ''}-c TimeZone=UTC`);
  }
  // URLSearchParams renders spaces as "+", while PostgreSQL's libpq-style
  // connection URI expects percent-encoded spaces inside the options value.
  // Restrict this conversion to options so literal "+" characters in
  // credentials and unrelated query values retain their meaning.
  return parsed.toString().replace(/([?&]options=)([^&]*)/, (_match, prefix, value) => (
    `${prefix}${String(value).replace(/\+/g, '%20')}`
  ));
}

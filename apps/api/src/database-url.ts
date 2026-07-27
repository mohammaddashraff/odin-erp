export function enforceTlsVerification(databaseUrl: string): string {
  return databaseUrl.replace(
    /([?&])sslmode=(?:prefer|require|verify-ca)(?=(&|$))/gi,
    '$1sslmode=verify-full',
  );
}

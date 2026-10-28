import { AccountType } from '@prisma/client';

const rootPrefixes: Record<AccountType, string> = {
  ASSET: 'AS',
  LIABILITY: 'LI',
  EQUITY: 'EQ',
  REVENUE: 'RE',
  COGS: 'CG',
  EXPENSE: 'EX',
  OTHER_INCOME: 'OI',
  OTHER_EXPENSE: 'OE',
};

export function accountCodePrefix(type: AccountType, parentCode?: string | null) {
  // Keep room for a sequence even when a legacy parent has a long manual code.
  return parentCode && parentCode.length <= 30
    ? `${parentCode}.`
    : `${rootPrefixes[type]}-`;
}

export function nextAvailableAccountCode(codes: Iterable<string>, prefix: string) {
  const used = new Set<string>();
  let highest = 0n;
  for (const raw of codes) {
    const code = raw.toUpperCase();
    used.add(code);
    if (!code.startsWith(prefix)) continue;
    const suffix = code.slice(prefix.length);
    if (/^\d+$/.test(suffix)) {
      const number = BigInt(suffix);
      if (number > highest) highest = number;
    }
  }
  let number = highest + 1n;
  while (true) {
    const code = `${prefix}${number.toString().padStart(3, '0')}`;
    if (code.length > 40) throw new Error('Account code sequence is exhausted.');
    if (!used.has(code)) return code;
    number += 1n;
  }
}

import { AccountType } from '@prisma/client';
import { accountCodePrefix, nextAvailableAccountCode } from './account-code';

describe('automatic account codes', () => {
  it('follows the parent code and skips existing account or resource numbers', () => {
    const prefix = accountCodePrefix(AccountType.ASSET, '1300');
    expect(prefix).toBe('1300.');
    expect(nextAvailableAccountCode(['1300.001', '1300.002', '1300.002-OLD'], prefix)).toBe('1300.003');
  });
  it('uses a bounded type prefix for long legacy parent codes', () => {
    const prefix = accountCodePrefix(AccountType.LIABILITY, 'LONG-ACCOUNT-CODE-THAT-EXCEEDS-THIRTY-CHARS');
    expect(prefix).toBe('LI-');
    expect(nextAvailableAccountCode(['LI-001'], prefix)).toBe('LI-002');
  });
});

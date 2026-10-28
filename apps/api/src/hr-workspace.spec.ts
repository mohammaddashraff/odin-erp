import { hrDate, hrKind, hrRecordInput, leaveBalance, assertAnnualLeaveBalance } from './hr-workspace';

describe('HR business validation', () => {
  it('rejects unknown kinds and impossible dates', () => {
    expect(() => hrKind('accounts')).toThrow();
    expect(() => hrDate('2026-02-30')).toThrow();
    expect(hrDate('2028-02-29')).toBe('2028-02-29');
  });
  it('validates attendance times and absence', () => {
    expect(hrRecordInput('attendance', { date: '2026-10-02', checkIn: '09:00', checkOut: '17:00' }).status).toBe('RECORDED');
    for (const data of [{ checkIn: '17:00', checkOut: '09:00' }, { checkOut: '17:00' }, { checkIn: '25:00' }, { attendanceStatus: 'ABSENT', checkIn: '09:00' }])
      expect(() => hrRecordInput('attendance', { date: '2026-10-02', ...data })).toThrow();
  });
  it('counts only configured working days and rejects reversed ranges', () => {
    expect(hrRecordInput('leave', { startDate: '2026-10-02', endDate: '2026-10-04' }).data.days).toBe(1);
    expect(() => hrRecordInput('leave', { startDate: '2026-10-04', endDate: '2026-10-02' })).toThrow();
  });
  it('computes salary with exact integer currency arithmetic', () => {
    const result = hrRecordInput('payroll', { month: '2026-10', allowance: '100.25', deduction: '20.15' }, 100000n);
    expect(result.data.netMinor).toBe('108010');
    expect(result.status).toBe('DRAFT');
    expect(() => hrRecordInput('payroll', { month: '2026-13' }, 100n)).toThrow();
    expect(() => hrRecordInput('payroll', { month: '2026-10' }, null)).toThrow();
    expect(() => hrRecordInput('payroll', { month: '2026-10', deduction: '2' }, 100n)).toThrow();
    expect(() => hrRecordInput('payroll', { month: '2026-10', allowance: '-1' }, 100n)).toThrow();
  });
  it('uses each employee’s work week and rejects leave containing only rest days', () => {
    expect(hrRecordInput('leave', { startDate: '2026-10-02', endDate: '2026-10-04' }, null, [5,6]).data.days).toBe(2);
    expect(() => hrRecordInput('leave', { startDate: '2026-10-02', endDate: '2026-10-03' })).toThrow(/working days/);
  });
  it('reserves pending days, charges approved days, ignores cancelled and rejected leave', () => {
    const data = { leaveType: 'ANNUAL', chargedDates: ['2026-10-05','2026-10-06'] };
    const rows = [{ status: 'APPROVED', data }, { status: 'SUBMITTED', data }, { status: 'CANCELLED', data }, { status: 'REJECTED', data }];
    expect(leaveBalance(10, rows, 2026)).toEqual({ year: 2026, allowance: 10, used: 2, pending: 2, remaining: 8, available: 6 });
    expect(() => assertAnnualLeaveBalance(3, rows, data)).toThrow(/exceeds/);
    expect(() => assertAnnualLeaveBalance(null, [], data)).toThrow(/allowance/);
    expect(() => assertAnnualLeaveBalance(3, rows, data, false)).toThrow(/exceeds/);
  });
  it('allocates cross-year leave correctly without charging sick leave to the annual balance', () => {
    const data = { leaveType: 'ANNUAL', chargedDates: ['2026-12-31','2027-01-03'] };
    expect(leaveBalance(5, [{ status: 'APPROVED', data }], 2026).used).toBe(1);
    expect(leaveBalance(5, [{ status: 'APPROVED', data }], 2027).used).toBe(1);
    expect(leaveBalance(null, [{ status: 'APPROVED', data: { ...data, leaveType: 'SICK' } }], 2026).available).toBeNull();
    expect(() => assertAnnualLeaveBalance(null, [], { ...data, leaveType: 'SICK' })).not.toThrow();
  });

});

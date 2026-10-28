import { BadRequestException } from '@nestjs/common';
import { money } from './money';

export const hrKinds = ['attendance', 'leave', 'payroll'] as const;
export type HrKind = typeof hrKinds[number];
export function hrKind(value: string): HrKind {
  if (!(hrKinds as readonly string[]).includes(value)) throw new BadRequestException('HR section is invalid.');
  return value as HrKind;
}
export function hrDate(value: unknown): string {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text)
    throw new BadRequestException('Enter a valid date.');
  return text;
}
export function hrRecordInput(kind: HrKind, body: any, salaryMinor?: bigint | null, workDays: number[] = [0,1,2,3,4]) {
  const notes = String(body.notes || '').trim().slice(0, 2000);
  if (kind === 'attendance') {
    const date = hrDate(body.date);
    const attendanceStatus = String(body.attendanceStatus || 'PRESENT');
    if (!['PRESENT', 'ABSENT', 'REMOTE'].includes(attendanceStatus)) throw new BadRequestException('Attendance status is invalid.');
    const checkIn = String(body.checkIn || '');
    const checkOut = String(body.checkOut || '');
    for (const time of [checkIn, checkOut]) if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new BadRequestException('Enter a valid time.');
    if ((checkOut && !checkIn) || (checkIn && checkOut && checkOut <= checkIn) || (attendanceStatus === 'ABSENT' && (checkIn || checkOut)))
      throw new BadRequestException('Check-out must follow check-in; absent employees cannot have attendance times.');
    return { recordKey: date, status: 'RECORDED', data: { date, attendanceStatus, checkIn, checkOut, notes } };
  }
  if (kind === 'leave') {
    const startDate = hrDate(body.startDate), endDate = hrDate(body.endDate);
    if (endDate < startDate) throw new BadRequestException('Leave end date must follow the start date.');
    const leaveType = String(body.leaveType || 'ANNUAL');
    if (!['ANNUAL', 'SICK', 'UNPAID'].includes(leaveType)) throw new BadRequestException('Leave type is invalid.');
    if (Date.parse(endDate) - Date.parse(startDate) > 365 * 86400000) throw new BadRequestException('A leave request cannot exceed 366 calendar days.');
    const chargedDates = leaveDates(startDate, endDate).filter((day) => workDays.includes(new Date(day).getUTCDay()));
    if (!chargedDates.length) throw new BadRequestException('This leave does not include any scheduled working days.');
    return { recordKey: `${startDate}:${endDate}`, status: 'SUBMITTED', data: { startDate, endDate, leaveType, days: chargedDates.length, chargedDates, notes } };
  }
  const month = String(body.month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('Select a valid payroll month.');
  if (salaryMinor == null) throw new BadRequestException('Set the employee base salary before preparing payroll.');
  const allowanceMinor = money(body.allowance || '0', 'allowance'), deductionMinor = money(body.deduction || '0', 'deduction');
  const netMinor = salaryMinor + allowanceMinor - deductionMinor;
  if (salaryMinor < 0n || allowanceMinor < 0n || deductionMinor < 0n || netMinor < 0n) throw new BadRequestException('Salary amounts must be non-negative and deductions cannot exceed earnings.');
  return { recordKey: month, status: 'DRAFT', data: { month, salaryMinor: String(salaryMinor), allowanceMinor: String(allowanceMinor), deductionMinor: String(deductionMinor), netMinor: String(netMinor), notes } };
}

export function leaveDates(start: string, end: string): string[] {
  const result: string[] = [];
  for (let day = Date.parse(start); day <= Date.parse(end); day += 86400000) result.push(new Date(day).toISOString().slice(0,10));
  return result;
}
export function leaveBalance(annualLeaveDays: number | null, rows: Array<{ status: string; data: any }>, year: number) {
  let used = 0, pending = 0;
  for (const row of rows) {
    if (row.data.leaveType !== 'ANNUAL' || !['APPROVED','SUBMITTED'].includes(row.status)) continue;
    const dates: string[] = row.data.chargedDates || leaveDates(row.data.startDate, row.data.endDate);
    const days = dates.filter((day) => day.startsWith(`${year}-`)).length;
    if (row.status === 'APPROVED') used += days; else pending += days;
  }
  return { year, allowance: annualLeaveDays, used, pending, remaining: annualLeaveDays == null ? null : annualLeaveDays - used, available: annualLeaveDays == null ? null : annualLeaveDays - used - pending };
}
export function assertAnnualLeaveBalance(annualLeaveDays: number | null, rows: Array<{ status: string; data: any }>, data: any, reservePending = true) {
  if (data.leaveType !== 'ANNUAL') return;
  if (annualLeaveDays == null) throw new BadRequestException('Set the annual leave allowance in the employee profile first.');
  const dates: string[] = data.chargedDates || leaveDates(data.startDate, data.endDate);
  const years = [...new Set(dates.map((day) => Number(day.slice(0,4))))];
  for (const year of years) {
    const balance = leaveBalance(annualLeaveDays, rows, year);
    const available = reservePending ? balance.available! : balance.remaining!;
    if (dates.filter((day) => day.startsWith(`${year}-`)).length > available) throw new BadRequestException('The annual leave request exceeds the available balance.');
  }
}

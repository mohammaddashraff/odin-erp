import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Request, Response } from 'express';
import PDFDocument from 'pdfkit';
import { AccountingPdfReport, createAccountingPdf } from './accounting-pdf';
import { existsSync } from 'node:fs';
import { Actor, AuthService, publicActor } from './auth';
import { RequireAnyPermission, RequirePermissions } from './authorization.guard';
import { ErpService } from './erp.service';
import { apiDateTime, apiLabel, ApiLanguage, apiMinorCurrency, apiQuantity, apiText, requestLanguage } from './i18n';
import { RequireStepUp } from './step-up.guard';
import { accountingCsv } from './accounting-csv';
import { accountingReportNames } from './accounting-workspace';

type AuthRequest = Request & { actor: Actor };
const id = (value: string) => BigInt(value);
const accountingId = (value: string) => {
  if (!/^[1-9]\d*$/.test(value)) throw new BadRequestException('Accounting identifier is invalid.');
  return BigInt(value);
};
const refreshCookieName = 'av8_refresh';
const cookieValue = (request: Request, name: string) => String(request.headers.cookie || '').split(';').map((value) => value.trim()).find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || '';
const refreshCookieOptions = (expiresAt?: Date) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/auth',
  ...(expiresAt ? { expires: expiresAt } : {}),
});

@Controller('api')
export class ErpController {
  constructor(private readonly erp: ErpService, private readonly auth: AuthService) {}

  @Get('health')
  async health() {
    try {
      return await this.erp.health();
    } catch {
      throw new ServiceUnavailableException({ api: 'ok', database: 'unhealthy', timestamp: new Date().toISOString() });
    }
  }

  @Post('auth/login')
  async login(@Req() request: Request, @Body() body: any, @Res({ passthrough: true }) response: Response) {
    const result: any = await this.auth.login(String(body.email || ''), String(body.password || ''), body.rememberMe !== false, {
      ipAddress: request.ip || request.socket.remoteAddress,
      userAgent: String(request.headers['user-agent'] || ''),
    });
    if (!result.refreshToken) return result;
    const { refreshToken, refreshExpiresAt, ...session } = result;
    response.cookie(refreshCookieName, refreshToken, refreshCookieOptions(refreshExpiresAt || undefined));
    return session;
  }

  @Post('auth/mfa/verify')
  async verifyMfa(@Body() body: any, @Res({ passthrough: true }) response: Response) {
    const { refreshToken, refreshExpiresAt, ...session } = await this.auth.completeMfaChallenge(String(body.challengeToken || ''), String(body.code || ''), String(body.recoveryCode || ''));
    response.cookie(refreshCookieName, refreshToken, refreshCookieOptions(refreshExpiresAt || undefined));
    return session;
  }

  @Post('auth/refresh')
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const { refreshToken, refreshExpiresAt, ...session } = await this.auth.refresh(cookieValue(request, refreshCookieName));
    response.cookie(refreshCookieName, refreshToken, refreshCookieOptions(refreshExpiresAt || undefined));
    return session;
  }

  @Post('auth/logout')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(cookieValue(request, refreshCookieName));
    response.clearCookie(refreshCookieName, refreshCookieOptions());
    return { ok: true };
  }

  @Get('auth/me')
  me(@Req() request: AuthRequest) { return publicActor(request.actor); }

  @Post('auth/mfa/enroll')
  beginMfaEnrollment(@Req() request: AuthRequest, @Body() body: any) { return this.auth.beginMfaEnrollment(request.actor, String(body.password || '')); }

  @Post('auth/mfa/enroll/confirm')
  confirmMfaEnrollment(@Req() request: AuthRequest, @Body() body: any) { return this.auth.confirmMfaEnrollment(request.actor, String(body.code || '')); }

  @Post('auth/step-up')
  stepUp(@Req() request: AuthRequest, @Body() body: any) { return this.auth.stepUp(request.actor, String(body.password || ''), String(body.code || ''), String(body.recoveryCode || '')); }

  @Post('auth/logout-all')
  @RequireStepUp()
  async logoutAll(@Req() request: AuthRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.logoutAll(request.actor);
    response.clearCookie(refreshCookieName, refreshCookieOptions());
    return result;
  }

  @Post('auth/change-password')
  @RequireStepUp()
  async changePassword(@Req() request: AuthRequest, @Body() body: any, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.changePassword(request.actor, String(body.currentPassword || ''), String(body.newPassword || ''));
    response.clearCookie(refreshCookieName, refreshCookieOptions());
    return result;
  }

  @Get('bootstrap')
  bootstrap(@Req() request: AuthRequest) { return this.erp.bootstrap(request.actor); }

  @Post('masters/customers')
  @RequirePermissions('sales.customer.create')
  createCustomer(@Req() request: AuthRequest, @Body() body: any) { return this.erp.createCustomer(request.actor, body); }

  @Get('sales/customers')
  @RequirePermissions('sales.customer.view')
  customers(@Req() request: AuthRequest, @Query() query: any) { return this.erp.listCustomers(request.actor, query); }

  @Get('sales/customers/:id')
  @RequirePermissions('sales.customer.view')
  customer(@Req() request: AuthRequest, @Param('id') customerId: string) { return this.erp.customerDetail(request.actor, id(customerId)); }

  @Patch('masters/customers/:id')
  @RequirePermissions('sales.customer.edit')
  updateCustomer(@Req() request: AuthRequest, @Param('id') customerId: string, @Body() body: any) { return this.erp.updateCustomer(request.actor, id(customerId), body); }

  @Post('masters/suppliers')
  @RequirePermissions('purchasing.supplier.create')
  createSupplier(@Req() request: AuthRequest, @Body() body: any) { return this.erp.createSupplier(request.actor, body); }

  @Post('masters/categories')
  @RequirePermissions('inventory.item.create')
  createCategory(@Req() request: AuthRequest, @Body() body: any) { return this.erp.createCategory(request.actor, body); }

  @Post('masters/units')
  @RequirePermissions('inventory.item.create')
  createUnit(@Req() request: AuthRequest, @Body() body: any) { return this.erp.createUnit(request.actor, body); }

  @Post('masters/items')
  @RequirePermissions('inventory.item.create')
  createItem(@Req() request: AuthRequest, @Body() body: any) { return this.erp.createItem(request.actor, body); }

  @Post('masters/warehouses')
  @RequirePermissions('inventory.warehouse.create')
  createWarehouse(@Req() request: AuthRequest, @Body() body: any) { return this.erp.createWarehouse(request.actor, body); }

  @Post('masters/bank-accounts')
  @RequirePermissions('banking.account.create')
  createBankAccount(@Req() request: AuthRequest, @Body() body: any) { return this.erp.createBankAccount(request.actor, body); }

  @Get('dashboard')
  @RequirePermissions('dashboard.overview.view')
  dashboard(@Req() request: AuthRequest) { return this.erp.dashboard(request.actor); }

  @Get('sales/overview')
  @RequirePermissions('sales.overview.view')
  salesOverview(@Req() request: AuthRequest) { return this.erp.salesOverview(request.actor); }

  @Get('sales/documents')
  @RequireAnyPermission('sales.quotation.view', 'sales.order.view', 'sales.delivery.view', 'sales.invoice.view', 'sales.return.view', 'sales.credit_note.view')
  salesDocuments(@Req() request: AuthRequest, @Query() query: any) { return this.erp.salesDocuments(request.actor, query); }

  @Get('references/sales-employees')
  @RequireAnyPermission('sales.quotation.view', 'sales.quotation.create', 'sales.order.view')
  salesEmployees(@Req() request: AuthRequest, @Query('branchId') branchId?: string) { return this.erp.salesEmployees(request.actor, branchId); }

  @Get('hr/employees/:id/profile')
  @RequirePermissions('hr.employee.view')
  hrProfile(@Req() request: AuthRequest, @Param('id') value: string, @Query('year') year?: string) { return this.erp.hrProfile(request.actor, accountingId(value), year); }

  @Post('hr/leave/:id/cancel')
  @RequirePermissions('hr.leave.cancel')
  cancelHrLeave(@Req() request: AuthRequest, @Param('id') value: string, @Body() body: any) { return this.erp.cancelHrLeave(request.actor, accountingId(value), body); }

  @Get('hr/departments')
  @RequireAnyPermission('hr.employee.view', 'hr.department.view')
  hrDepartments(@Req() request: AuthRequest) { return this.erp.hrDepartments(request.actor); }

  @Post('hr/departments')
  @RequirePermissions('hr.department.create')
  createHrDepartment(@Req() request: AuthRequest, @Body() body: any) { return this.erp.saveHrDepartment(request.actor, body); }

  @Patch('hr/departments/:id')
  @RequirePermissions('hr.department.edit')
  updateHrDepartment(@Req() request: AuthRequest, @Param('id') value: string, @Body() body: any) { return this.erp.saveHrDepartment(request.actor, body, accountingId(value)); }

  @Post('hr/employees')
  @RequirePermissions('hr.employee.create')
  createHrEmployee(@Req() request: AuthRequest, @Body() body: any) { return this.erp.saveHrEmployee(request.actor, body); }

  @Patch('hr/employees/:id')
  @RequirePermissions('hr.employee.edit')
  updateHrEmployee(@Req() request: AuthRequest, @Param('id') value: string, @Body() body: any) { return this.erp.saveHrEmployee(request.actor, body, accountingId(value)); }

  @Get('hr/records/:kind')
  @RequireAnyPermission('hr.attendance.view', 'hr.leave.view', 'hr.payroll.view')
  hrRecords(@Req() request: AuthRequest, @Param('kind') kind: string) { return this.erp.hrRecords(request.actor, kind); }

  @Post('hr/records/:kind')
  @RequireAnyPermission('hr.attendance.create', 'hr.leave.create', 'hr.payroll.create')
  createHrRecord(@Req() request: AuthRequest, @Param('kind') kind: string, @Body() body: any) { return this.erp.saveHrRecord(request.actor, kind, body); }

  @Patch('hr/records/:id/review')
  @RequireAnyPermission('hr.leave.approve', 'hr.leave.reject', 'hr.payroll.approve', 'hr.payroll.reject')
  reviewHrRecord(@Req() request: AuthRequest, @Param('id') value: string, @Body() body: any) { return this.erp.reviewHrRecord(request.actor, accountingId(value), body); }

  @Patch('hr/records/:kind/:id')
  @RequireAnyPermission('hr.attendance.edit', 'hr.leave.edit', 'hr.payroll.edit')
  editHrRecord(@Req() request: AuthRequest, @Param('kind') kind: string, @Param('id') value: string, @Body() body: any) { return this.erp.saveHrRecord(request.actor, kind, body, accountingId(value)); }

  @Get('hr/employees')
  @RequirePermissions('hr.employee.view')
  employees(@Req() request: AuthRequest, @Query() query: any) { return this.erp.employees(request.actor, query); }

  @Get('exchange-rates')
  @RequireAnyPermission('sales.quotation.view', 'sales.quotation.create', 'purchasing.order.view')
  exchangeRate(@Req() request: AuthRequest, @Query('currency') currency: string, @Query('date') rateDate?: string) { return this.erp.exchangeRate(request.actor, currency, rateDate); }

  @Get('documents')
  documents(@Req() request: AuthRequest, @Query('type') type?: string, @Query('status') status?: string) { return this.erp.listDocuments(request.actor, type, status); }

  @Post('documents')
  createDocument(@Req() request: AuthRequest, @Body() body: any) { return this.erp.createDocument(request.actor, body); }

  @Patch('documents/:id')
  updateDocument(@Req() request: AuthRequest, @Param('id') documentId: string, @Body() body: any) { return this.erp.updateDocument(request.actor, id(documentId), body); }

  @Get('documents/:id')
  document(@Req() request: AuthRequest, @Param('id') documentId: string) { return this.erp.documentDetail(request.actor, id(documentId)); }

  @Post('documents/:id/convert')
  convert(@Req() request: AuthRequest, @Param('id') documentId: string, @Body() body: any) { return this.erp.convertDocument(request.actor, id(documentId), body); }

  @Post('documents/:id/submit')
  submitDocument(@Req() request: AuthRequest, @Param('id') documentId: string, @Body() body: any) { return this.erp.workflow(request.actor, id(documentId), 'submit', body); }

  @Post('documents/:id/approve')
  approveDocument(@Req() request: AuthRequest, @Param('id') documentId: string, @Body() body: any) { return this.erp.workflow(request.actor, id(documentId), 'approve', body); }

  @Post('documents/:id/reject')
  rejectDocument(@Req() request: AuthRequest, @Param('id') documentId: string, @Body() body: any) { return this.erp.workflow(request.actor, id(documentId), 'reject', body); }

  @Post('documents/:id/request-changes')
  requestChanges(@Req() request: AuthRequest, @Param('id') documentId: string, @Body() body: any) { return this.erp.workflow(request.actor, id(documentId), 'request-changes', body); }

  @Post('documents/:id/comment')
  commentDocument(@Req() request: AuthRequest, @Param('id') documentId: string, @Body() body: any) { return this.erp.commentDocument(request.actor, id(documentId), body); }

  @Post('documents/:id/post')
  postDocument(@Req() request: AuthRequest, @Param('id') documentId: string) { return this.erp.postDocument(request.actor, id(documentId)); }

  @Get('payments')
  @RequireAnyPermission('payments.receipt.view', 'payments.payment.view')
  payments(@Req() request: AuthRequest) { return this.erp.payments(request.actor); }

  @Post('payments')
  @RequireAnyPermission('payments.receipt.create', 'payments.payment.create')
  createPayment(@Req() request: AuthRequest, @Body() body: any) { return this.erp.createPayment(request.actor, body); }

  @Post('payments/:id/approve')
  @RequirePermissions('payments.payment.approve')
  approvePayment(@Req() request: AuthRequest, @Param('id') paymentId: string, @Body() body: any) {
    return this.erp.paymentWorkflow(request.actor, id(paymentId), 'approve', body);
  }

  @Post('payments/:id/reject')
  @RequirePermissions('payments.payment.reject')
  rejectPayment(@Req() request: AuthRequest, @Param('id') paymentId: string, @Body() body: any) {
    return this.erp.paymentWorkflow(request.actor, id(paymentId), 'reject', body);
  }

  @Get('accounting/accounts/next-code')
  @RequirePermissions('accounting.account.create')
  suggestedAccountingAccountCode(@Req() request: AuthRequest, @Query() query: any) { return this.erp.suggestedAccountingAccountCode(request.actor, query); }

  @Get('accounting/accounts')
  @RequirePermissions('accounting.account.view')
  accountingAccounts(@Req() request: AuthRequest, @Query() query: any) { return this.erp.accountingAccounts(request.actor, query); }

  @Post('accounting/accounts')
  @RequirePermissions('accounting.account.create')
  createAccountingAccount(@Req() request: AuthRequest, @Body() body: any) { return this.erp.saveAccountingAccount(request.actor, null, body); }

  @Patch('accounting/accounts/:id')
  @RequirePermissions('accounting.account.edit')
  updateAccountingAccount(@Req() request: AuthRequest, @Param('id') accountId: string, @Body() body: any) { return this.erp.saveAccountingAccount(request.actor, accountingId(accountId), body); }

  @Get('accounting/ledger')
  @RequirePermissions('accounting.journal.view')
  accountingLedger(@Req() request: AuthRequest, @Query() query: any) { return this.erp.accountingLedger(request.actor, query); }

  @Get('accounting/journals')
  @RequirePermissions('accounting.journal.view')
  accountingJournals(@Req() request: AuthRequest, @Query() query: any) { return this.erp.accountingJournals(request.actor, query); }

  @Get('accounting/journals/:id')
  @RequirePermissions('accounting.journal.view')
  accountingJournalDetail(@Req() request: AuthRequest, @Param('id') journalId: string) { return this.erp.journalDetail(request.actor, accountingId(journalId)); }

  @Get('journals/:id')
  @RequirePermissions('accounting.journal.view')
  journalDetail(@Req() request: AuthRequest, @Param('id') journalId: string) { return this.erp.journalDetail(request.actor, accountingId(journalId)); }

  @Get('journals')
  @RequirePermissions('accounting.journal.view')
  journals(@Req() request: AuthRequest) { return this.erp.journals(request.actor); }

  @Post('journals')
  @RequirePermissions('accounting.journal.create')
  createJournal(@Req() request: AuthRequest, @Body() body: any) { return this.erp.createJournal(request.actor, body); }

  @Patch('journals/:id')
  @RequirePermissions('accounting.journal.edit')
  updateJournal(@Req() request: AuthRequest, @Param('id') journalId: string, @Body() body: any) { return this.erp.updateJournal(request.actor, id(journalId), body); }

  @Post('journals/:id/:action')
  journalAction(@Req() request: AuthRequest, @Param('id') journalId: string, @Param('action') action: 'submit' | 'approve' | 'reject' | 'post', @Body() body: any) { return this.erp.journalWorkflow(request.actor, id(journalId), action, body); }

  @Post('journals/:id/reverse/create')
  @RequirePermissions('accounting.journal.create')
  reverseJournal(@Req() request: AuthRequest, @Param('id') journalId: string, @Body() body: any) { return this.erp.reverseJournal(request.actor, id(journalId), body); }

  @Patch('periods/:id')
  @RequirePermissions('accounting.period.manage')
  @RequireStepUp()
  period(@Req() request: AuthRequest, @Param('id') periodId: string, @Body() body: any) { return this.erp.updatePeriod(request.actor, id(periodId), String(body.status)); }

  @Post('periods')
  @RequirePermissions('accounting.period.manage')
  @RequireStepUp()
  createPeriod(@Req() request: AuthRequest, @Body() body: any) { return this.erp.createPeriod(request.actor, body); }

  @Get('pos')
  @RequirePermissions('pos.register.view')
  pos(@Req() request: AuthRequest) { return this.erp.posState(request.actor); }

  @Post('pos/shifts')
  @RequirePermissions('pos.shift.create')
  openShift(@Req() request: AuthRequest, @Body() body: any) { return this.erp.openShift(request.actor, body); }

  @Post('pos/shifts/:id/close')
  @RequirePermissions('pos.shift.edit')
  closeShift(@Req() request: AuthRequest, @Param('id') shiftId: string, @Body() body: any) { return this.erp.closeShift(request.actor, id(shiftId), body); }

  @Post('pos/sales')
  @RequirePermissions('pos.sale.create')
  createSale(@Req() request: AuthRequest, @Body() body: any) { return this.erp.createPosSale(request.actor, body); }

  @Post('pos/sales/:id/resume')
  @RequirePermissions('pos.sale.edit')
  resumeSale(@Req() request: AuthRequest, @Param('id') saleId: string, @Body() body: any) { return this.erp.resumePosSale(request.actor, id(saleId), body); }

  @Post('pos/sales/:id/return')
  @RequirePermissions('pos.return.create')
  returnSale(@Req() request: AuthRequest, @Param('id') saleId: string, @Body() body: any) { return this.erp.returnPosSale(request.actor, id(saleId), body); }

  @Get('pos/sales/:id/pdf')
  @RequirePermissions('pos.sale.print')
  async posReceipt(@Req() request: AuthRequest, @Param('id') saleId: string, @Res() response: Response) {
    const sale: any = await this.erp.posSaleDetail(request.actor, id(saleId));
    const language = requestLanguage(request);
    const rows = sale.lines.map((line: any) => ({ sku: line.item.sku, item: language === 'ar' && line.item.nameAr && line.item.nameAr !== line.item.name ? line.item.nameAr : apiText(line.item.name, language), quantityMilli: line.quantityMilli, unitPriceMinor: line.unitPriceMinor, discountMinor: line.discountMinor, taxMinor: line.taxMinor, totalMinor: line.totalMinor }));
    this.writePdf(response, `POS RECEIPT ${sale.number}`, rows, { customer: sale.customer?.name || 'Walk-in customer', register: sale.shift.registerCode, subtotalMinor: sale.subtotalMinor, discountMinor: sale.discountMinor, taxMinor: sale.taxMinor, totalMinor: sale.totalMinor, tenders: sale.tenders.map((tender: any) => `${apiText(tender.method, language)} ${apiMinorCurrency(tender.amountMinor, language)}`).join(' + ') }, `${sale.number}.pdf`, language);
  }

  @Get('banking')
  @RequireAnyPermission('banking.account.view', 'banking.transaction.view', 'banking.statement.view')
  banking(@Req() request: AuthRequest) { return this.erp.banking(request.actor); }

  @Post('banking/transactions')
  @RequirePermissions('banking.transaction.create')
  bankTransaction(@Req() request: AuthRequest, @Body() body: any) { return this.erp.createBankTransaction(request.actor, body); }

  @Post('banking/statements')
  @RequirePermissions('banking.statement.create')
  statement(@Req() request: AuthRequest, @Body() body: any) { return this.erp.createStatement(request.actor, body); }

  @Post('banking/statement-lines/:id/match')
  @RequirePermissions('banking.statement.reconcile')
  match(@Req() request: AuthRequest, @Param('id') lineId: string, @Body() body: any) { return this.erp.matchStatementLine(request.actor, id(lineId), id(body.transactionId)); }

  @Get('approvals')
  @RequirePermissions('approvals.queue.view')
  approvals(@Req() request: AuthRequest) { return this.erp.approvals(request.actor); }

  @Get('audit')
  @RequirePermissions('audit.business.view')
  audit(@Req() request: AuthRequest) { return this.erp.auditLog(request.actor); }

  @Get('evidence/:reference')
  @RequireAnyPermission('audit.business.view', 'approvals.queue.history')
  evidence(@Req() request: AuthRequest, @Param('reference') reference: string) { return this.erp.referenceEvidence(request.actor, reference); }

  @Get('reports/:name')
  @RequireAnyPermission('reports.standard.view', 'reports.profitability.view')
  report(@Req() request: AuthRequest, @Param('name') name: string, @Query() query: any) { return this.erp.report(request.actor, name, undefined, query); }

  @Get('reports/:name/csv')
  @RequireAnyPermission('reports.standard.export', 'reports.profitability.export')
  async reportCsv(@Req() request: AuthRequest, @Param('name') name: string, @Res() response: Response, @Query() query: any) {
    const report: any = await this.erp.reportOutput(request.actor, name, 'export', query);
    if (accountingReportNames.has(name)) { response.type('text/csv').setHeader('Content-Disposition', `attachment; filename="${name}.csv"`).send(accountingCsv(report, requestLanguage(request))); return; }
    const rows = report.rows || [];
    const headers: string[] = [...new Set<string>(rows.flatMap((row: any) => Object.keys(row)).filter((key: string) => typeof rows.find((row: any) => row[key] !== undefined)?.[key] !== 'object'))];
    const language = requestLanguage(request);
    const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = `\uFEFF${[headers.map((header) => quote(apiLabel(header, language))).join(','), ...rows.map((row: any) => headers.map((header) => quote(typeof row[header] === 'string' ? apiText(row[header], language) : row[header])).join(','))].join('\n')}`;
    response.type('text/csv').setHeader('Content-Disposition', `attachment; filename="${name}.csv"`).send(csv);
  }

  @Get('reports/:name/pdf')
  @RequireAnyPermission('reports.standard.print', 'reports.profitability.print')
  async reportPdf(@Req() request: AuthRequest, @Param('name') name: string, @Res() response: Response, @Query() query: any) {
    const report: any = await this.erp.reportOutput(request.actor, name, 'print', query);
    this.writePdf(response, report.name, report.rows || [], report.totals || {}, `${name}.pdf`, requestLanguage(request), report);
  }

  @Get('documents/:id/pdf')
  async documentPdf(@Req() request: AuthRequest, @Param('id') documentId: string, @Res() response: Response) {
    const document: any = await this.erp.documentOutput(request.actor, id(documentId), 'print');
    const language = requestLanguage(request);
    const rows = document.lines.map((line: any) => ({ sku: line.item.sku, item: language === 'ar' && line.item.nameAr && line.item.nameAr !== line.item.name ? line.item.nameAr : apiText(line.item.name, language), quantityMilli: line.quantityMilli, unitPriceMinor: line.unitPriceMinor, taxMinor: line.taxMinor, totalMinor: line.totalMinor }));
    this.writePdf(response, `${document.type} ${document.number}`, rows, { party: document.customer?.name || document.supplier?.name || 'Internal', documentDate: document.documentDate, subtotalMinor: document.subtotalMinor, discountMinor: document.discountMinor, taxMinor: document.taxMinor, totalMinor: document.totalMinor, status: document.status }, `${document.number}.pdf`, language);
  }

  @Post('system/reset')
  @RequirePermissions('settings.system.reset')
  @RequireStepUp()
  reset(@Req() request: AuthRequest, @Body() body: any) { return this.erp.reset(request.actor, body); }

  private writePdf(response: Response, title: string, rows: any[], totals: any, filename: string, language: ApiLanguage = 'en', report?: AccountingPdfReport) {
    if (report && ['Trial balance', 'General ledger', 'Account ledger', 'Income statement', 'Balance sheet'].includes(report.name)) {
      const document = createAccountingPdf(report, language);
      response.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${filename}"`);
      document.pipe(response);
      document.end();
      return;
    }
    response.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${filename}"`);
    const localizedTitle = apiText(title, language);
    const doc = new PDFDocument({ margin: 42, size: 'A4', info: { Title: localizedTitle, Author: 'Odin ERP' } });
    doc.pipe(response);
    if (language === 'ar') {
      const font = [process.env.ODIN_ARABIC_FONT, '/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '/System/Library/Fonts/Supplemental/Geeza Pro.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find((path) => path && existsSync(path));
      if (font) doc.font(font);
    }
    const align = language === 'ar' ? 'right' : 'left';
    const display = (key: string, value: unknown) => {
      if (key.toLowerCase().includes('minor')) return apiMinorCurrency(value, language);
      if (key.toLowerCase().includes('quantity')) return apiQuantity(value, language);
      if (key.toLowerCase().includes('date') && value) return new Date(String(value)).toISOString().slice(0, 10);
      return apiText(value, language);
    };
    const label = (key: string) => apiLabel(key, language);
    const rowKeys = [...new Set<string>(rows.flatMap((row) => Object.keys(row)))]
      .filter((key) => key !== 'id' && rows.some((row) => row[key] !== undefined && typeof row[key] !== 'object'));
    const drawPageHeader = () => {
      doc.fillColor('#2b6cff').fontSize(10).text('ODIN ERP', 42, 42, { width: 511, characterSpacing: 2 });
      doc.fillColor('#101828').fontSize(21).text(localizedTitle, 42, 62, { width: 511, align, ellipsis: true, lineBreak: false });
      doc.fillColor('#667085').fontSize(9).text(`${apiText('Generated', language)} ${apiDateTime(new Date(), language)}`, 42, 94, { width: 511, align, lineBreak: false });
      doc.strokeColor('#d0d5dd').moveTo(42, 114).lineTo(553, 114).stroke();
    };
    const columnWidth = 511 / Math.max(rowKeys.length, 1);
    const drawTableHeader = (top: number) => {
      doc.save().fillColor('#eef4ff').rect(42, top, 511, 24).fill().restore();
      rowKeys.forEach((key, index) => doc.fillColor('#344054').fontSize(7.5).text(label(key), 47 + index * columnWidth, top + 8, { width: columnWidth - 10, align, ellipsis: true, lineBreak: false }));
      return top + 24;
    };
    drawPageHeader();
    let y = drawTableHeader(128);
    rows.forEach((row, index) => {
      if (y > 742) { doc.addPage(); drawPageHeader(); y = drawTableHeader(128); }
      if (index % 2) doc.save().fillColor('#f8fafc').rect(42, y, 511, 24).fill().restore();
      rowKeys.forEach((key, column) => doc.fillColor('#101828').fontSize(7.5).text(display(key, row[key]), 47 + column * columnWidth, y + 8, { width: columnWidth - 10, align, ellipsis: true, lineBreak: false }));
      y += 24;
    });
    y += 16;
    doc.fillColor('#2b6cff').fontSize(10).text(apiText('SUMMARY', language), 42, y, { width: 511, align, characterSpacing: language === 'ar' ? 0 : 1.2 });
    y += 18;
    Object.entries(totals).forEach(([key, value]) => {
      if (y > 750) { doc.addPage(); y = 48; }
      doc.fillColor('#667085').fontSize(8).text(label(key), 42, y, { width: 170, lineBreak: false });
      doc.fillColor('#101828').fontSize(9).text(display(key, value), 220, y, { width: 333, align: 'right', ellipsis: true, lineBreak: false });
      y += 17;
    });
    doc.end();
  }
}

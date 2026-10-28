import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AccessControlService } from './access-control.service';
import { AccessGovernanceService } from './access-governance.service';
import type { Actor } from './auth';
import { RequirePermissions } from './authorization.guard';
import { RequireStepUp } from './step-up.guard';

type AuthRequest = Request & { actor: Actor };
const id = (value: string) => BigInt(value);
const context = (request: AuthRequest) => ({
  ipAddress: request.ip || request.socket.remoteAddress,
  requestId: typeof request.headers['x-request-id'] === 'string' ? request.headers['x-request-id'] : undefined,
});

@Controller('api/access')
export class AccessControlController {
  constructor(private readonly access: AccessControlService, private readonly governance: AccessGovernanceService) {}

  @Get()
  @RequirePermissions('system.super_admin')
  overview(@Req() request: AuthRequest) { return this.access.overview(request.actor); }

  @Post('roles')
  @RequirePermissions('system.super_admin')
  @RequireStepUp()
  createRole(@Req() request: AuthRequest, @Body() body: any) { return this.access.createRole(request.actor, body, context(request)); }

  @Patch('roles/:id')
  @RequirePermissions('system.super_admin')
  @RequireStepUp()
  updateRole(@Req() request: AuthRequest, @Param('id') roleId: string, @Body() body: any) { return this.access.updateRole(request.actor, id(roleId), body, context(request)); }

  @Post('roles/:id/duplicate')
  @RequirePermissions('system.super_admin')
  @RequireStepUp()
  duplicateRole(@Req() request: AuthRequest, @Param('id') roleId: string, @Body() body: any) { return this.access.duplicateRole(request.actor, id(roleId), body, context(request)); }

  @Post('roles/:id/archive')
  @RequirePermissions('system.super_admin')
  @RequireStepUp()
  archiveRole(@Req() request: AuthRequest, @Param('id') roleId: string) { return this.access.archiveRole(request.actor, id(roleId), context(request)); }

  @Patch('users/:id')
  @RequirePermissions('system.super_admin')
  @RequireStepUp()
  updateUser(@Req() request: AuthRequest, @Param('id') userId: string, @Body() body: any) { return this.access.updateUser(request.actor, id(userId), body, context(request)); }

  @Post('users')
  @RequirePermissions('system.super_admin')
  @RequireStepUp()
  createUser(@Req() request: AuthRequest, @Body() body: any) { return this.access.createUser(request.actor, body, context(request)); }

  @Post('users/:id/mfa-reset')
  @RequirePermissions('system.super_admin')
  @RequireStepUp()
  resetMfa(@Req() request: AuthRequest, @Param('id') userId: string, @Body() body: any) { return this.access.resetUserMfa(request.actor, id(userId), String(body.reason || ''), context(request)); }

  @Get('companies')
  @RequirePermissions('settings.users_access.view')
  companies(@Req() request: AuthRequest) { return this.governance.companies(request.actor); }

  @Post('companies')
  @RequirePermissions('system.super_admin')
  @RequireStepUp()
  createCompany(@Req() request: AuthRequest, @Body() body: any) { return this.governance.createCompany(request.actor, body, context(request)); }

  @Post('companies/:companyId/memberships/:userId')
  @RequirePermissions('settings.users_access.manage')
  @RequireStepUp()
  membership(@Req() request: AuthRequest, @Param('companyId') companyId: string, @Param('userId') userId: string, @Body() body: any) {
    return this.governance.upsertMembership(request.actor, id(companyId), id(userId), body, context(request));
  }

  @Post('companies/:companyId/financial-resources')
  @RequirePermissions('settings.users_access.manage')
  @RequireStepUp()
  financialResource(@Req() request: AuthRequest, @Param('companyId') companyId: string, @Body() body: any) {
    return this.governance.createFinancialResource(request.actor, id(companyId), body, context(request));
  }

  @Post('financial-resources/:resourceId/assignments')
  @RequirePermissions('settings.users_access.manage')
  @RequireStepUp()
  resourceAssignment(@Req() request: AuthRequest, @Param('resourceId') resourceId: string, @Body() body: any) {
    return this.governance.assignFinancialResource(request.actor, resourceId, body, context(request));
  }

  @Post('financial-resource-assignments/:assignmentId/revoke')
  @RequirePermissions('settings.users_access.manage')
  @RequireStepUp()
  revokeResourceAssignment(@Req() request: AuthRequest, @Param('assignmentId') assignmentId: string) {
    return this.governance.revokeFinancialResourceAssignment(request.actor, id(assignmentId), context(request));
  }

  @Post('temporary-grants')
  @RequirePermissions('settings.users_access.manage')
  @RequireStepUp()
  temporaryGrant(@Req() request: AuthRequest, @Body() body: any) { return this.governance.createTemporaryGrant(request.actor, body, context(request)); }

  @Post('temporary-grants/:grantId/revoke')
  @RequirePermissions('settings.users_access.manage')
  @RequireStepUp()
  revokeTemporaryGrant(@Req() request: AuthRequest, @Param('grantId') grantId: string) { return this.governance.revokeTemporaryGrant(request.actor, grantId, context(request)); }

  @Post('delegations')
  @RequireStepUp()
  delegation(@Req() request: AuthRequest, @Body() body: any) { return this.governance.createDelegation(request.actor, body, context(request)); }

  @Post('delegations/:delegationId/revoke')
  @RequireStepUp()
  revokeDelegation(@Req() request: AuthRequest, @Param('delegationId') delegationId: string) { return this.governance.revokeDelegation(request.actor, delegationId, context(request)); }

  @Get('users/:id/effective')
  @RequirePermissions('settings.users_access.view')
  effective(@Req() request: AuthRequest, @Param('id') userId: string, @Query('companyId') companyId: string) {
    return this.governance.effectiveAccess(request.actor, id(userId), id(companyId));
  }

  @Post('simulate')
  @RequirePermissions('settings.users_access.view')
  simulate(@Req() request: AuthRequest, @Body() body: any) { return this.governance.simulate(request.actor, body); }

  @Get('reviews')
  @RequirePermissions('settings.users_access.view')
  reviews(@Req() request: AuthRequest, @Query('companyId') companyId: string, @Query('userId') userId?: string) {
    return this.governance.reviews(request.actor, id(companyId), userId ? id(userId) : undefined);
  }

  @Post('reviews')
  @RequirePermissions('settings.users_access.manage')
  @RequireStepUp()
  createReview(@Req() request: AuthRequest, @Body() body: any) { return this.governance.createReview(request.actor, body, context(request)); }

  @Post('authority-policies')
  @RequirePermissions('settings.users_access.manage')
  @RequireStepUp()
  authorityPolicy(@Req() request: AuthRequest, @Body() body: any) { return this.governance.createAuthorityPolicy(request.actor, body, context(request)); }
}

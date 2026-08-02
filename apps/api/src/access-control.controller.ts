import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AccessControlService } from './access-control.service';
import type { Actor } from './auth';
import { RequirePermissions } from './authorization.guard';

type AuthRequest = Request & { actor: Actor };
const id = (value: string) => BigInt(value);
const context = (request: AuthRequest) => ({
  ipAddress: request.ip || request.socket.remoteAddress,
  requestId: typeof request.headers['x-request-id'] === 'string' ? request.headers['x-request-id'] : undefined,
});

@Controller('api/access')
@RequirePermissions('system.super_admin')
export class AccessControlController {
  constructor(private readonly access: AccessControlService) {}

  @Get()
  overview(@Req() request: AuthRequest) { return this.access.overview(request.actor); }

  @Post('roles')
  @RequirePermissions('settings.users_access.manage')
  createRole(@Req() request: AuthRequest, @Body() body: any) { return this.access.createRole(request.actor, body, context(request)); }

  @Patch('roles/:id')
  @RequirePermissions('settings.users_access.manage')
  updateRole(@Req() request: AuthRequest, @Param('id') roleId: string, @Body() body: any) { return this.access.updateRole(request.actor, id(roleId), body, context(request)); }

  @Post('roles/:id/duplicate')
  @RequirePermissions('settings.users_access.manage')
  duplicateRole(@Req() request: AuthRequest, @Param('id') roleId: string, @Body() body: any) { return this.access.duplicateRole(request.actor, id(roleId), body, context(request)); }

  @Post('roles/:id/archive')
  @RequirePermissions('settings.users_access.manage')
  archiveRole(@Req() request: AuthRequest, @Param('id') roleId: string) { return this.access.archiveRole(request.actor, id(roleId), context(request)); }

  @Patch('users/:id')
  @RequirePermissions('settings.users_access.manage')
  updateUser(@Req() request: AuthRequest, @Param('id') userId: string, @Body() body: any) { return this.access.updateUser(request.actor, id(userId), body, context(request)); }
}

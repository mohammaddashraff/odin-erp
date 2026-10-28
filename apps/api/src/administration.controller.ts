import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { AdministrationService } from './administration.service';
import { RequirePermissions } from './authorization.guard';
import { RequireStepUp } from './step-up.guard';
const id = (value: string) => { if (!/^[1-9]\d{0,17}$/.test(value))
    throw new BadRequestException('Invalid account identifier.'); return BigInt(value); };
@Controller('api')
export class AdministrationController {
    constructor(private readonly admin: AdministrationService) { }
    @Get('administration/authority-limits')
    @RequirePermissions('settings.users_access.view')
    authorityLimits(
    @Req()
    req: any) { return this.admin.authorityLimits(req.actor); }
    @Get('administration/diagnostics')
    @RequirePermissions('settings.system.view')
    diagnostics() { return this.admin.diagnostics(); }
    @Get('profile')
    profile(
    @Req()
    req: any) { return this.admin.profile(req.actor, req.actor.userId, true); }
    @Patch('profile')
    updateSelf(
    @Req()
    req: any, 
    @Body()
    body: any) { return this.admin.updateProfile(req.actor, req.actor.userId, body, true); }
    @Get('administration')
    @RequirePermissions('settings.users_access.view')
    directory(
    @Req()
    req: any) { return this.admin.directory(req.actor); }
    @Get('administration/users/:id')
    @RequirePermissions('settings.users_access.view')
    user(
    @Req()
    req: any, 
    @Param('id')
    userId: string) { return this.admin.profile(req.actor, id(userId)); }
    @Patch('administration/users/:id/details')
    @RequirePermissions('system.super_admin')
    @RequireStepUp()
    details(
    @Req()
    req: any, 
    @Param('id')
    userId: string, 
    @Body()
    body: any) { return this.admin.updateProfile(req.actor, id(userId), body); }
    @Post('administration/users/:id/recover')
    @RequirePermissions('system.super_admin')
    @RequireStepUp()
    recover(
    @Req()
    req: any, 
    @Param('id')
    userId: string, 
    @Body()
    body: any) { return this.admin.recover(req.actor, id(userId), body); }
    @Post('administration/users/:id/preview')
    @RequirePermissions('system.super_admin')
    preview(
    @Req()
    req: any, 
    @Param('id')
    userId: string, 
    @Body()
    body: any) { return this.admin.preview(req.actor, id(userId), body); }
}

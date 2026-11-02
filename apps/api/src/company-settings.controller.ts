import { BadRequestException, Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import { RequireAnyPermission } from './authorization.guard';
import { CompanySettingsService } from './company-settings.service';
import { RequireStepUp } from './step-up.guard';

const companyId = (value: string) => {
  if (!/^[1-9]\d{0,17}$/.test(value)) throw new BadRequestException('Invalid company identifier.');
  return BigInt(value);
};

@Controller('api/company-settings')
export class CompanySettingsController {
  constructor(private readonly settings: CompanySettingsService) {}

  @Get()
  @RequireAnyPermission('settings.system.view', 'settings.users_access.manage', 'system.super_admin')
  list(@Req() request: any) {
    return this.settings.list(request.actor);
  }

  @Patch(':id')
  @RequireAnyPermission('settings.users_access.manage', 'system.super_admin')
  @RequireStepUp()
  update(@Req() request: any, @Param('id') id: string, @Body() body: any) {
    return this.settings.update(request.actor, companyId(id), body);
  }
}

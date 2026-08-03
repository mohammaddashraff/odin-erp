import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Actor } from './auth';
import { AuthService } from './auth';

const STEP_UP_METADATA = 'odin.require-step-up';
export const RequireStepUp = () => SetMetadata(STEP_UP_METADATA, true);

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<boolean>(STEP_UP_METADATA, [context.getHandler(), context.getClass()]);
    if (!required) return true;
    const request = context.switchToHttp().getRequest<{ actor?: Actor; headers?: Record<string, unknown> }>();
    const token = typeof request.headers?.['x-odin-step-up'] === 'string' ? request.headers['x-odin-step-up'] : '';
    if (!request.actor) return false;
    return this.auth.verifyStepUp(token, request.actor);
  }
}

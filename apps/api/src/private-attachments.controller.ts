import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import type { Actor } from './auth';
import {
  ABSOLUTE_ATTACHMENT_MAX_BYTES,
  PrivateAttachmentsService,
  sanitizeAttachmentFilename,
} from './private-attachments.service';

type AuthRequest = Request & { actor: Actor };
type MemoryUpload = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

const uploadLimits = {
  // Multer enforces the invariant hard ceiling. The service reads the runtime
  // configured (usually smaller) limit for every request, after environment
  // loading, so import order cannot silently freeze a stale value.
  fileSize: ABSOLUTE_ATTACHMENT_MAX_BYTES,
  files: 1,
  fields: 3,
  parts: 4,
  fieldNameSize: 80,
  fieldSize: 64 * 1024,
  headerPairs: 50,
};

function requestContext(request: AuthRequest) {
  return {
    ipAddress: request.ip || request.socket.remoteAddress,
    userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined,
    requestId: typeof request.headers['x-request-id'] === 'string' ? request.headers['x-request-id'] : undefined,
    route: String(request.originalUrl || request.path || '').split('?')[0],
    httpMethod: request.method,
  };
}

export function attachmentContentDisposition(filename: string) {
  const safe = sanitizeAttachmentFilename(filename);
  const ascii = safe.replace(/[^A-Za-z0-9._() -]/g, '_').replace(/\s+/g, ' ').trim() || 'attachment';
  const encoded = encodeURIComponent(safe).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

@Controller('api/private-attachments')
export class PrivateAttachmentsController {
  constructor(private readonly attachments: PrivateAttachmentsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: uploadLimits }))
  upload(
    @Req() request: AuthRequest,
    @Body() body: any,
    @UploadedFile() file?: MemoryUpload,
  ) {
    return this.attachments.upload(request.actor, {
      documentId: body.documentId,
      filename: file?.originalname || body.filename,
      contentType: file?.mimetype || body.contentType,
      content: file?.buffer,
      contentBase64: file ? undefined : body.contentBase64,
    }, requestContext(request));
  }

  @Get()
  list(@Req() request: AuthRequest, @Query('documentId') documentId: string) {
    return this.attachments.list(request.actor, documentId);
  }

  @Post(':id/ticket')
  ticket(@Req() request: AuthRequest, @Param('id') attachmentId: string) {
    return this.attachments.createDownloadTicket(request.actor, attachmentId, requestContext(request));
  }

  @Get(':id/download')
  async download(
    @Req() request: AuthRequest,
    @Param('id') attachmentId: string,
    @Query('ticket') ticket: string,
    @Res() response: Response,
  ) {
    const download = await this.attachments.download(request.actor, attachmentId, ticket, requestContext(request));
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    response.setHeader('Content-Type', download.contentType);
    response.setHeader('Content-Length', String(download.sizeBytes));
    response.setHeader('Content-Disposition', attachmentContentDisposition(download.filename));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.status(HttpStatus.OK).send(download.content);
  }
}

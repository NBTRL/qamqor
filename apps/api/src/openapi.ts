import { type INestApplication } from '@nestjs/common';
import { StrictValidationPipe } from './common/strict-validation.pipe.js';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { Request, Response, NextFunction } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_PREFIX, CONTRACT_VERSION, SWAGGER_PATH } from '@club/shared';
import { ApiErrorDto } from './common/dto.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { ApiException } from './common/api-exception.js';
import { ErrorCode } from '@club/shared';
import { JsonSerializer } from './common/http.js';
import { getEnvironment } from './config/environment.js';

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX.slice(1));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new JsonSerializer());
  app.useGlobalPipes(
    new StrictValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
      exceptionFactory: (errors) =>
        new ApiException(ErrorCode.VALIDATION_ERROR, {
          fields: errors.map((error) => ({
            path: error.property,
            messages: Object.values(error.constraints ?? {}),
          })),
        }),
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          upgradeInsecureRequests: getEnvironment().NODE_ENV === 'production' ? [] : null,
        },
      },
    }),
  );
  app.use(cookieParser());
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith(API_PREFIX)) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.enableCors({ origin: getEnvironment().WEB_URL, credentials: true });
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
}
export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Клуб волонтеров API')
    .setDescription('API одного клуба волонтеров. Подробные правила: docs/CONTRACT.md.')
    .setVersion(CONTRACT_VERSION)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addCookieAuth('club_refresh')
    .build();
  return SwaggerModule.createDocument(app, config, { extraModels: [ApiErrorDto] });
}
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup(SWAGGER_PATH.slice(1), app, createOpenApiDocument(app));
}

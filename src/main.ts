import './types/express';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';

const logger = new Logger('Bootstrap');

/** Exactly 10 ports: 3000 … 3009 (stays below 3010). */
const PORT_RANGE_FIRST = 3000;
const PORT_RANGE_LAST = 3009;
const PORT_COUNT = PORT_RANGE_LAST - PORT_RANGE_FIRST + 1;

async function listenOnFirstAvailablePort(
  app: INestApplication,
): Promise<number> {
  for (let port = PORT_RANGE_FIRST; port <= PORT_RANGE_LAST; port++) {
    try {
      await app.listen(port);
      if (port !== PORT_RANGE_FIRST) {
        logger.warn(
          `Ports ${PORT_RANGE_FIRST}-${port - 1} were in use; listening on ${port}`,
        );
      } else {
        logger.log(`Listening on port ${port}`);
      }
      return port;
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as NodeJS.ErrnoException).code
          : undefined;
      if (code === 'EADDRINUSE') {
        if (port < PORT_RANGE_LAST) {
          continue;
        }
        throw new Error(
          `No free port in range ${PORT_RANGE_FIRST}-${PORT_RANGE_LAST} (all ${PORT_COUNT} ports in use)`,
        );
      }
      throw err;
    }
  }

  throw new Error(
    `No free port in range ${PORT_RANGE_FIRST}-${PORT_RANGE_LAST} (all ${PORT_COUNT} ports in use)`,
  );
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Account Management API')
    .setDescription('Banking transactions API')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        in: 'header',
      },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await listenOnFirstAvailablePort(app);
}

void bootstrap();

import { createServer } from 'node:http';

import { parseServerConfig } from '@pdfmason/config/server';
import { createSafeLogger } from '@pdfmason/observability';

import { ProductionWorkerCoordinator } from './coordinator.js';

const config = parseServerConfig(process.env);
const logger = createSafeLogger((entry) => process.stdout.write(`${entry}\n`));
const coordinator =
  config.providerMode === 'production' ? new ProductionWorkerCoordinator(config, logger) : null;
let tickActive = false;

const tick = async (): Promise<void> => {
  if (coordinator === null || tickActive) return;
  tickActive = true;
  try {
    await coordinator.tick();
  } catch {
    logger.log('error', 'worker.tick_failed', {
      errorCode: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
  } finally {
    tickActive = false;
  }
};

const timer = setInterval(() => void tick(), config.worker.pollIntervalMs);
timer.unref();

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(
      JSON.stringify({
        cloudOperations: ['demo.integrity@1.0.0'],
        pdfCapabilities: 0,
        providerMode: config.providerMode,
        service: 'pdfmason-worker',
        status: 'ready',
      }),
    );
    return;
  }

  response.writeHead(404, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }));
});

server.listen(config.workerPort, config.worker.host, () => {
  logger.log('info', 'worker.ready', {
    environment: config.providerMode,
    operation: 'demo.integrity',
    workerVersion: '0.0.0',
  });
  void tick();
});

const close = (): void => {
  clearInterval(timer);
  server.close();
};

process.on('SIGINT', close);
process.on('SIGTERM', close);

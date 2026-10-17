import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { installProcessLogging } from './logs/process.js';
import { RotatingFile } from './logs/rotating-file.js';
import { PARTYHUB_ENGINE } from './packages/engine.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const journal = config.logFile
    ? new RotatingFile({
        dir: config.logFile.dir,
        maxBytes: config.logFile.maxBytes,
        maxFiles: config.logFile.maxFiles,
      })
    : undefined;
  const logger = createLogger(config.logLevel, false, journal);
  installProcessLogging(logger);
  logger.info(
    {
      event: 'app.start',
      version: PARTYHUB_ENGINE.version,
      node: process.version,
      pid: process.pid,
      logLevel: config.logLevel,
      logFile: journal?.file ?? null,
    },
    'Démarrage de PartyHub',
  );

  const server = await createServer({ config, logger, journal });
  const port = await server.listen();
  logger.info({ event: 'app.listening', port, host: config.host }, 'PartyHub démarré');

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ event: 'app.stopping', signal }, 'Arrêt en cours');
    // Filet de sécurité : si l’arrêt propre bloque, on sort quand même.
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    server
      .close()
      .then(() => {
        logger.info({ event: 'app.stopped' }, 'Arrêt propre terminé');
        process.exit(0);
      })
      .catch((err: unknown) => {
        logger.error({ event: 'app.stop-failed', err }, 'Erreur pendant l’arrêt');
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('Échec du démarrage de PartyHub :', err);
  process.exit(1);
});

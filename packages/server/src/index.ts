import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const server = await createServer({ config, logger });
  const port = await server.listen();
  logger.info({ port, host: config.host }, 'PartyHub démarré');

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Arrêt en cours');
    // Filet de sécurité : si l'arrêt propre bloque, on sort quand même.
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    server
      .close()
      .then(() => {
        logger.info('Arrêt propre terminé');
        process.exit(0);
      })
      .catch((err: unknown) => {
        logger.error({ err }, 'Erreur pendant l’arrêt');
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

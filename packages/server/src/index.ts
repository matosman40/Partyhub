import path from 'node:path';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { installProcessLogging } from './logs/process.js';
import { RotatingFile } from './logs/rotating-file.js';
import { PARTYHUB_ENGINE } from './packages/engine.js';
import { createServer } from './server.js';
import { readSavedOverrides, resolveBootEnv } from './server-settings.js';

async function main(): Promise<void> {
  // Réglages enregistrés depuis l’administration : ils remplacent le fichier .env (voir server-settings.ts).
  const dataDir = process.env.DATA_DIR?.trim() || path.resolve(process.cwd(), 'data');
  const boot = resolveBootEnv(process.env, readSavedOverrides(path.join(dataDir, 'partyhub.db')));
  const config = loadConfig(boot.env);
  const journal = config.logFile
    ? new RotatingFile({
        dir: config.logFile.dir,
        maxBytes: config.logFile.maxBytes,
        maxFiles: config.logFile.maxFiles,
      })
    : undefined;
  const logger = createLogger(config.logLevel, false, journal);
  installProcessLogging(logger);
  if (boot.error) {
    logger.warn(
      { event: 'config.saved-ignored', reason: boot.error },
      'Réglages enregistrés ignorés : le démarrage utilise le fichier .env',
    );
  }
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

  let server: Awaited<ReturnType<typeof createServer>> | null = null;
  const restart = () => {
    logger.info({ event: 'app.restart' }, 'Redémarrage demandé par l’administrateur');
    void server?.close().finally(() => process.exit(0));
  };
  server = await createServer({
    config,
    logger,
    journal,
    bootEnv: process.env,
    bootOverrides: boot.overrides,
    onRestart: restart,
  });
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

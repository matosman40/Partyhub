import type { Logger } from '../logger.js';

/**
 * Journalise les erreurs qui échappent à tout le reste, avant que le processus ne s’arrête.
 * Une exception non gérée arrête le serveur (le conteneur le relance) ; une promesse rejetée non gérée
 * est journalisée et le serveur continue.
 */
export function installProcessLogging(logger: Logger, exit: (code: number) => void = process.exit): void {
  process.on('uncaughtException', (err) => {
    logger.fatal({ event: 'process.crash', err }, 'Erreur non gérée : arrêt du serveur');
    exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : { message: String(reason) };
    logger.error({ event: 'process.rejection', err }, 'Promesse rejetée sans gestion');
  });
}

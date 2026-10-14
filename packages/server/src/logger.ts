import { pino, type Logger as PinoLogger } from 'pino';

export type Logger = PinoLogger;

/**
 * Journalisation structurée.
 * Règle : ne jamais passer en paramètre un contenu de réponse, un jeton
 * ou un mot de passe. Les journaux ne contiennent que des identifiants de salle.
 */
export function createLogger(level: string, silent = false): Logger {
  return pino({
    level: silent ? 'silent' : level,
    base: { app: 'partyhub' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

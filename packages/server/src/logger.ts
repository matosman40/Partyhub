import { pino, multistream, type Logger as PinoLogger } from 'pino';
import type { RotatingFile } from './logs/rotating-file.js';

export type Logger = PinoLogger;

/** Champs jamais écrits dans les journaux, même si un appel les transmet par erreur. */
const REDACTED_PATHS = [
  'password',
  '*.password',
  'token',
  '*.token',
  'hostToken',
  '*.hostToken',
  'githubToken',
  'authorization',
  '*.authorization',
  'headers.cookie',
  'req.headers.cookie',
  'headers.authorization',
];

/**
 * Journalisation structurée. Chaque ligne est un objet JSON : `level`, `time`, `msg`, puis les champs
 * propres à l'événement (`event`, `source`, `req`, `room`…). Sortie standard, et fichier tournant si fourni.
 * Règle : ne jamais passer en paramètre un contenu de réponse, un jeton ou un mot de passe.
 */
export function createLogger(level: string, silent = false, file?: RotatingFile): Logger {
  if (silent) return pino({ level: 'silent' });
  const streams: { level: string; stream: { write(chunk: string): void } }[] = [{ level, stream: process.stdout }];
  if (file) streams.push({ level, stream: { write: (chunk: string) => file.write(chunk) } });
  return pino(
    {
      level,
      base: { app: 'partyhub' },
      timestamp: pino.stdTimeFunctions.isoTime,
      // Le niveau est écrit en toutes lettres (« error ») : plus simple à filtrer qu'un code numérique.
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: REDACTED_PATHS, censor: '[masqué]' },
    },
    multistream(streams),
  );
}

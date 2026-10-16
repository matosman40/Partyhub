import { z } from 'zod';
import type { Logger } from '../logger.js';

/** Format d'une erreur envoyée par le navigateur. Tout champ est borné : rien ne peut gonfler le journal. */
const extraValue = z.union([z.string().max(300), z.number(), z.boolean(), z.null()]);

export const clientEntrySchema = z.object({
  level: z.enum(['error', 'warn', 'info']),
  kind: z.enum(['boundary', 'window', 'promise', 'console', 'api', 'socket', 'page']),
  message: z.string().max(1000),
  stack: z.string().max(4000).optional(),
  path: z.string().max(300).optional(),
  time: z.string().max(40).optional(),
  session: z.string().max(80).optional(),
  app: z.string().max(20).optional(),
  ua: z.string().max(300).optional(),
  screen: z.string().max(40).optional(),
  online: z.boolean().optional(),
  extra: z.record(z.string().max(60), extraValue).optional(),
});

export const clientBatchSchema = z.object({
  entries: z.array(clientEntrySchema).min(1).max(25),
});

export type ClientEntry = z.infer<typeof clientEntrySchema>;

/** Au plus `max` lots par adresse et par minute : un navigateur qui boucle ne remplit pas le disque. */
export class BatchLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly max = 30,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  allow(ip: string): boolean {
    const t = this.now();
    const current = this.hits.get(ip);
    if (!current || t - current.start >= this.windowMs) {
      if (this.hits.size > 5000) this.hits.clear();
      this.hits.set(ip, { start: t, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= this.max;
  }
}

/**
 * Écrit les erreurs du navigateur dans le même journal que le serveur, avec `source: "client"`.
 * `ip` sert au diagnostic ; aucun contenu de réponse, jeton ou mot de passe n'est attendu ici.
 */
export function recordClientEntries(logger: Logger, entries: ClientEntry[], ip: string): void {
  for (const entry of entries) {
    const fields = {
      source: 'client',
      event: `client.${entry.kind}`,
      session: entry.session,
      path: entry.path,
      clientTime: entry.time,
      app: entry.app,
      ua: entry.ua,
      screen: entry.screen,
      online: entry.online,
      stack: entry.stack,
      extra: entry.extra,
      ip,
    };
    logger[entry.level](fields, entry.message);
  }
}

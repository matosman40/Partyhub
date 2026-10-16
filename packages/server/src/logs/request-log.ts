import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../logger.js';

/** Identifiant court d'une requête : permet de relier une erreur à la requête qui l'a provoquée. */
export function requestIdOf(res: Response): string | undefined {
  const id = res.locals.requestId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Trace chaque requête : identifiant (en-tête X-Request-Id), durée et statut.
 * 5xx : erreur ; autres 4xx : avertissement ; 401 (session absente, attendue) et réussites : débogage.
 */
export function requestLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const id = randomBytes(4).toString('hex');
    res.locals.requestId = id;
    res.setHeader('X-Request-Id', id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
      const status = res.statusCode;
      const fields = { event: 'http.request', req: id, method: req.method, path: req.path, status, ms };
      // Une erreur 500 est déjà journalisée avec sa pile d'appels par le gestionnaire d'erreurs.
      if (status >= 500) {
        if (!res.locals.errorLogged) logger.error({ ...fields, event: 'http.error' }, 'Requête en erreur');
      } else if (status >= 400 && status !== 401) logger.warn({ ...fields, event: 'http.refused' }, 'Requête refusée');
      else logger.debug(fields, 'Requête traitée');
    });
    next();
  };
}

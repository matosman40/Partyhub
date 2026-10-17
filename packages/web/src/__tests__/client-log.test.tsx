import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BATCH_SIZE,
  MAX_QUEUE,
  clip,
  describeError,
  logClient,
  queuedForTests,
  resetClientLogForTests,
} from '../log/clientLog.js';
import { LogsAdmin } from '../admin/LogsAdmin.js';

/** Journal du navigateur : file, lots, renvoi après une panne, abandon après un refus. */

afterEach(() => {
  resetClientLogForTests();
  vi.unstubAllGlobals();
});

describe('describeError', () => {
  it('donne le message et la pile d’une erreur', () => {
    const { message, stack } = describeError(new Error('boom'));
    expect(message).toBe('boom');
    expect(stack).toContain('Error: boom');
  });

  it('accepte un texte ou un objet quelconque', () => {
    expect(describeError('seul').message).toBe('seul');
    expect(describeError({ code: 42 }).message).toBe('{"code":42}');
    expect(describeError(undefined).message).toBe('undefined');
  });
});

describe('clip', () => {
  it('coupe un texte trop long en l’indiquant', () => {
    expect(clip('abcdef', 3)).toBe('abc…');
    expect(clip('ab', 3)).toBe('ab');
  });
});

describe('file du journal', () => {
  it('envoie dix entrées en une seule requête, puis vide la file', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    for (let i = 0; i < BATCH_SIZE; i++) logClient('error', 'api', `erreur ${i}`);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/logs/client');
    const body = JSON.parse(String(init.body)) as { entries: Array<{ kind: string; message: string }> };
    expect(body.entries).toHaveLength(BATCH_SIZE);
    expect(body.entries[0]).toMatchObject({ kind: 'api', message: 'erreur 0' });
    await vi.waitFor(() => expect(queuedForTests()).toHaveLength(0));
  });

  it('garde au plus MAX_QUEUE entrées quand le réseau ne répond pas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    for (let i = 0; i < BATCH_SIZE + MAX_QUEUE + 50; i++) logClient('warn', 'console', `n ${i}`);
    expect(queuedForTests().length).toBe(MAX_QUEUE);
    // Les plus récentes sont gardées.
    expect(queuedForTests().at(-1)?.message).toBe(`n ${BATCH_SIZE + MAX_QUEUE + 49}`);
  });

  it('renvoie le lot après une erreur serveur, pour ne pas perdre l’information', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    for (let i = 0; i < BATCH_SIZE; i++) logClient('error', 'boundary', `à renvoyer ${i}`);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(queuedForTests()).toHaveLength(BATCH_SIZE));
    expect(queuedForTests()[0]?.message).toBe('à renvoyer 0');
  });

  it('abandonne le lot refusé pour cause de débit (429) : pas de boucle de renvoi', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    for (let i = 0; i < BATCH_SIZE; i++) logClient('error', 'socket', `trop ${i}`);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(queuedForTests()).toHaveLength(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ne fait rien hors navigateur sans erreur', () => {
    vi.stubGlobal('fetch', undefined);
    expect(() => logClient('info', 'page', 'test')).not.toThrow();
  });
});

describe('LogsAdmin', () => {
  it('affiche les filtres et les actions du journal', () => {
    const html = renderToStaticMarkup(<LogsAdmin />);
    expect(html).toContain('Alertes et erreurs');
    expect(html).toContain('Télécharger le journal');
    expect(html).toContain('Vider le journal');
    expect(html).not.toMatch(/NaN|undefined/);
  });
});

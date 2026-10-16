import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../logger.js';
import { RotatingFile } from '../logs/rotating-file.js';
import { groupEntries, parseLine, readJournal } from '../logs/journal.js';
import { BatchLimiter, clientBatchSchema } from '../logs/client-logs.js';
import { installProcessLogging } from '../logs/process.js';
import { createServer, type PartyServer } from '../server.js';
import type { AppConfig } from '../config.js';

const roots: string[] = [];

// Les lignes de journal des tests vont dans les fichiers temporaires, pas dans la sortie des tests.
let stdoutSpy: ReturnType<typeof vi.spyOn> | undefined;
beforeAll(() => {
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ph-logs-'));
  roots.push(dir);
  return dir;
}
afterAll(() => {
  stdoutSpy?.mockRestore();
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

describe('Fichier de journal qui tourne', () => {
  it('écrit dans le fichier courant et le met de côté au-delà de la taille maximale', () => {
    const dir = tempDir();
    const journal = new RotatingFile({ dir, maxBytes: 100, maxFiles: 2 });
    const line = `${'x'.repeat(40)}\n`;
    for (let i = 0; i < 6; i++) journal.write(line);
    // 6 lignes de 41 octets, 100 octets par fichier : 2 lignes par fichier, 2 fichiers gardés en plus du courant.
    expect(journal.files().map((f) => path.basename(f))).toEqual(['partyhub.log.2', 'partyhub.log.1', 'partyhub.log']);
    expect(existsSync(path.join(dir, 'partyhub.log.3'))).toBe(false);
  });

  it('vide tout l’historique à la demande', () => {
    const dir = tempDir();
    const journal = new RotatingFile({ dir, maxBytes: 10, maxFiles: 3 });
    journal.write('a'.repeat(20));
    journal.write('b'.repeat(20));
    journal.clear();
    expect(journal.files()).toEqual([]);
    journal.write('ok\n');
    expect(readFileSync(journal.file, 'utf8')).toBe('ok\n');
  });
});

describe('Journalisation', () => {
  it('écrit une ligne JSON par événement, avec le niveau en toutes lettres et les champs masqués', () => {
    const dir = tempDir();
    const journal = new RotatingFile({ dir, maxBytes: 1_000_000, maxFiles: 1 });
    const logger = createLogger('info', false, journal);
    logger.error({ event: 'test.secret', password: 'trop-secret', hostToken: 'jeton', room: 'ABCD' }, 'Essai');
    const line = JSON.parse(readFileSync(journal.file, 'utf8').trim()) as Record<string, unknown>;
    expect(line.level).toBe('error');
    expect(line.event).toBe('test.secret');
    expect(line.room).toBe('ABCD');
    expect(line.password).toBe('[masqué]');
    expect(line.hostToken).toBe('[masqué]');
  });

  it('lit le journal, filtre par niveau, source et texte, et regroupe les erreurs semblables', () => {
    const dir = tempDir();
    const journal = new RotatingFile({ dir, maxBytes: 1_000_000, maxFiles: 2 });
    const logger = createLogger('debug', false, journal);
    logger.info({ event: 'app.start' }, 'Démarrage');
    logger.error({ event: 'game.error', room: 'AAAA' }, 'Erreur du moteur de jeu');
    logger.error({ event: 'game.error', room: 'BBBB' }, 'Erreur du moteur de jeu');
    logger.warn({ event: 'http.refused', source: 'client' }, 'Requête refusée');

    const warnings = readJournal(journal, { minLevel: 'warn' });
    expect(warnings.matched).toBe(3);
    expect(warnings.entries[0]?.event).toBe('http.refused');

    const errorsOnly = readJournal(journal, { minLevel: 'error' });
    expect(errorsOnly.matched).toBe(2);

    const clientOnly = readJournal(journal, { minLevel: 'all', source: 'client' });
    expect(clientOnly.matched).toBe(1);

    const searched = readJournal(journal, { minLevel: 'all', text: 'AAAA' });
    expect(searched.matched).toBe(1);

    expect(warnings.groups[0]).toMatchObject({ event: 'game.error', count: 2, level: 'error' });
    expect(warnings.files).toBe(1);
  });

  it('ignore les lignes illisibles et les niveaux inconnus sans rien casser', () => {
    expect(parseLine('pas du json')).toBeNull();
    expect(parseLine('   ')).toBeNull();
    expect(parseLine('{"msg":"seul"}')).toMatchObject({
      level: 'info',
      source: 'server',
      event: 'app',
      message: 'seul',
    });
  });

  it('regroupe les messages en effaçant les chiffres', () => {
    const groups = groupEntries([
      {
        time: '2026-10-16T08:00:00Z',
        level: 'error',
        source: 'server',
        event: 'x',
        message: 'salle 1234 fermée',
        details: {},
      },
      {
        time: '2026-10-16T09:00:00Z',
        level: 'error',
        source: 'server',
        event: 'x',
        message: 'salle 9 fermée',
        details: {},
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(2);
    expect(groups[0]?.lastSeen).toBe('2026-10-16T09:00:00Z');
  });

  it('journalise les erreurs non gérées sans arrêter le processus pour une promesse', () => {
    const logged: Array<{ level: string; event: string }> = [];
    const logger = {
      fatal: (f: { event: string }) => logged.push({ level: 'fatal', event: f.event }),
      error: (f: { event: string }) => logged.push({ level: 'error', event: f.event }),
    } as unknown as Parameters<typeof installProcessLogging>[0];
    const before = process.listeners('unhandledRejection');
    installProcessLogging(logger, () => undefined);
    const handler = process.listeners('unhandledRejection').find((l) => !before.includes(l));
    handler?.(new Error('promesse perdue'), Promise.resolve());
    expect(logged).toEqual([{ level: 'error', event: 'process.rejection' }]);
    for (const l of process.listeners('unhandledRejection')) {
      if (!before.includes(l)) process.removeListener('unhandledRejection', l);
    }
    for (const l of process.listeners('uncaughtException')) {
      if (l.name === '' || l.toString().includes('process.crash')) process.removeListener('uncaughtException', l);
    }
  });
});

describe('Erreurs du navigateur', () => {
  it('accepte un lot bien formé et refuse un lot trop gros ou mal formé', () => {
    const entry = { level: 'error', kind: 'boundary', message: 'Écran de secours' };
    expect(clientBatchSchema.safeParse({ entries: [entry] }).success).toBe(true);
    expect(clientBatchSchema.safeParse({ entries: [] }).success).toBe(false);
    expect(clientBatchSchema.safeParse({ entries: Array(26).fill(entry) }).success).toBe(false);
    expect(clientBatchSchema.safeParse({ entries: [{ ...entry, kind: 'inconnu' }] }).success).toBe(false);
    expect(clientBatchSchema.safeParse({ entries: [{ ...entry, message: 'x'.repeat(1001) }] }).success).toBe(false);
  });

  it('limite le nombre de lots par adresse et par minute', () => {
    let now = 0;
    const limiter = new BatchLimiter(2, 1000, () => now);
    expect(limiter.allow('1.2.3.4')).toBe(true);
    expect(limiter.allow('1.2.3.4')).toBe(true);
    expect(limiter.allow('1.2.3.4')).toBe(false);
    expect(limiter.allow('5.6.7.8')).toBe(true);
    now = 1000;
    expect(limiter.allow('1.2.3.4')).toBe(true);
  });
});

describe('Routes de journal', () => {
  const started: PartyServer[] = [];
  afterEach(async () => {
    for (const s of started.splice(0)) await s.close().catch(() => undefined);
  });

  async function boot() {
    const dataDir = tempDir();
    const config: AppConfig = {
      port: 0,
      host: '127.0.0.1',
      dataDir,
      dbFile: path.join(dataDir, 'partyhub.db'),
      staticDir: '/nonexistent',
      adminPassword: 'journal-password-123',
      logLevel: 'silent',
      secureCookies: false,
    };
    const journal = new RotatingFile({ dir: path.join(dataDir, 'logs'), maxBytes: 1_000_000, maxFiles: 2 });
    // Comme en production : sortie standard et fichier tournant reçoivent les mêmes lignes.
    const logger = createLogger('info', false, journal);
    const server = await createServer({ config, logger, journal, sweepEveryMs: 0 });
    started.push(server);
    const port = await server.listen(0, '127.0.0.1');
    return { base: `http://127.0.0.1:${port}`, journal };
  }

  const batch = {
    entries: [
      {
        level: 'error',
        kind: 'boundary',
        message: 'Cannot read properties of undefined',
        stack: 'TypeError: ...\n    at Lobby',
        path: '/j/1234',
        session: 'abc123',
        extra: { component: 'LobbyHeads' },
      },
    ],
  };

  it('reçoit les erreurs du navigateur, les marque comme venant du navigateur et renvoie une réponse vide', async () => {
    const { base, journal } = await boot();
    const res = await fetch(`${base}/api/logs/client`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f]{8}$/);
    const result = readJournal(journal, { minLevel: 'error', source: 'client' });
    expect(result.entries[0]).toMatchObject({
      source: 'client',
      event: 'client.boundary',
      message: 'Cannot read properties of undefined',
    });
    expect(result.entries[0]?.details).toMatchObject({ session: 'abc123', path: '/j/1234' });
  });

  it('refuse un lot invalide sans rien écrire', async () => {
    const { base, journal } = await boot();
    const res = await fetch(`${base}/api/logs/client`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries: [{ level: 'nope' }] }),
    });
    expect(res.status).toBe(400);
    expect(readJournal(journal, { minLevel: 'all', source: 'client' }).matched).toBe(0);
  });

  it('réserve la consultation, le téléchargement et le vidage à l’administrateur', async () => {
    const { base, journal } = await boot();
    await fetch(`${base}/api/logs/client`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    });

    expect((await fetch(`${base}/api/admin/logs`)).status).toBe(401);
    expect((await fetch(`${base}/api/admin/logs/download`)).status).toBe(401);
    expect((await fetch(`${base}/api/admin/logs`, { method: 'DELETE' })).status).toBe(401);

    const login = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'journal-password-123' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    const listing = (await (
      await fetch(`${base}/api/admin/logs?level=error&source=client&q=Cannot`, { headers: { cookie } })
    ).json()) as { entries: Array<{ event: string }>; matched: number; groups: unknown[] };
    expect(listing.matched).toBe(1);
    expect(listing.entries[0]?.event).toBe('client.boundary');
    expect(listing.groups.length).toBe(1);

    const download = await fetch(`${base}/api/admin/logs/download`, { headers: { cookie } });
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('partyhub-journal-');
    expect(await download.text()).toContain('client.boundary');

    const cleared = await fetch(`${base}/api/admin/logs`, { method: 'DELETE', headers: { cookie } });
    expect(cleared.status).toBe(200);
    expect(readJournal(journal, { minLevel: 'error' }).matched).toBe(0);
  });

  it('refuse les lots trop nombreux d’une même adresse', async () => {
    const { base } = await boot();
    let last = 0;
    for (let i = 0; i < 40; i++) {
      const res = await fetch(`${base}/api/logs/client`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch),
      });
      last = res.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe('Configuration du journal', () => {
  it('garde au moins un fichier', () => {
    expect(() => new RotatingFile({ dir: tempDir(), maxBytes: 10, maxFiles: 0 })).toThrow();
    const file = path.join(tempDir(), 'x.log');
    writeFileSync(file, 'déjà là\n');
    expect(readFileSync(file, 'utf8')).toBe('déjà là\n');
  });
});

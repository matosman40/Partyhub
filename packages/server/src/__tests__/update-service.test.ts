import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createLogger } from '../logger.js';
import { PLATFORM_REPO, START_BLOCKED_MESSAGE, UpdateService, readAppVersion } from '../update/service.js';

const silent = createLogger('silent', true);
const roots: string[] = [];
const NOW = new Date('2026-10-19T08:00:00.000Z');

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function release(tag: string, extra: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    name: `PartyHub ${tag}`,
    published_at: '2026-10-18T10:00:00Z',
    body: `Notes ${tag}`,
    html_url: `https://github.com/${PLATFORM_REPO}/releases/tag/${tag}`,
    draft: false,
    prerelease: false,
    ...extra,
  };
}

const PUBLISHED = [
  release('v0.12.0'),
  release('v0.13.0'),
  release('v0.11.0'),
  release('v0.14.0', { draft: true }),
  release('v0.15.0', { prerelease: true }),
  release('karaoke-v1.0.0'),
];

interface Setup {
  list?: unknown[] | 'not-found';
  inGame?: number;
  installed?: boolean;
  backupOk?: boolean;
}

function setup(opts: Setup = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ph-update-'));
  roots.push(dataDir);
  let inGame = opts.inGame ?? 0;
  let backups = 0;
  const fetchImpl = (async () =>
    opts.list === 'not-found'
      ? new Response('', { status: 404 })
      : new Response(JSON.stringify(opts.list ?? PUBLISHED), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch;
  const service = new UpdateService({
    dataDir,
    currentVersion: '0.12.0',
    logger: silent,
    now: () => NOW,
    github: { fetch: fetchImpl },
    counts: () => ({ inGame, openRooms: 2 }),
    backup: () => {
      backups += 1;
      return opts.backupOk === false ? { ok: false, error: 'disque plein' } : { ok: true, name: 'backup-1.db' };
    },
  });
  if (opts.installed !== false) {
    writeFileSync(path.join(service.dir, 'updater-heartbeat.json'), JSON.stringify({ seenAt: NOW.toISOString() }));
  }
  return {
    service,
    dataDir,
    requestFile: path.join(service.dir, 'request.json'),
    setInGame: (n: number) => {
      inGame = n;
    },
    backups: () => backups,
  };
}

describe('Versions publiées', () => {
  it('liste les versions X.Y.Z publiées, la plus récente d’abord, sans brouillon ni préversion', async () => {
    const { service } = setup();
    const view = await service.view();
    expect(view.releases.map((r) => r.version)).toEqual(['0.13.0', '0.12.0', '0.11.0']);
    expect(view.releases[0]).toMatchObject({ newer: true, notes: 'Notes v0.13.0' });
    expect(view.releases[1]?.newer).toBe(false);
    expect(view.checkError).toBeNull();
  });

  it('une lecture GitHub en échec est signalée sans empêcher la page de s’afficher', async () => {
    const { service } = setup({ list: 'not-found' });
    const view = await service.view();
    expect(view.releases).toEqual([]);
    expect(view.checkError).toContain('introuvable');
    expect(view.current).toBe('0.12.0');
  });
});

describe('Demande de mise à jour', () => {
  it('est refusée tant que l’installeur de l’hôte n’est pas actif', async () => {
    const { service, requestFile } = setup({ installed: false });
    const result = await service.request('0.13.0');
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(existsSync(requestFile)).toBe(false);
  });

  it('sauvegarde la base, puis écrit la demande et bloque les nouvelles parties', async () => {
    const { service, requestFile, backups } = setup();
    const result = await service.request('0.13.0');
    expect(result.ok).toBe(true);
    expect(backups()).toBe(1);
    expect(JSON.parse(readFileSync(requestFile, 'utf8'))).toMatchObject({ version: '0.13.0', backup: 'backup-1.db' });
    expect(service.startBlockedReason()).toBe(START_BLOCKED_MESSAGE);
  });

  it('refuse une version qui n’est pas plus récente que la version en cours', async () => {
    const { service } = setup();
    expect(await service.request('0.12.0')).toMatchObject({ ok: false, status: 409 });
    expect(await service.request('0.11.0')).toMatchObject({ ok: false, status: 409 });
  });

  it('refuse un numéro de version mal formé, sans rien écrire', async () => {
    const { service, requestFile } = setup();
    expect(await service.request('../../etc')).toMatchObject({ ok: false, status: 400 });
    expect(await service.request('0.13')).toMatchObject({ ok: false, status: 400 });
    expect(existsSync(requestFile)).toBe(false);
  });

  it('refuse une version qui n’est pas publiée', async () => {
    const { service } = setup();
    expect(await service.request('0.20.0')).toMatchObject({ ok: false, status: 404 });
  });

  it('refuse pendant une partie, et ne sauvegarde pas la base pour rien', async () => {
    const { service, requestFile, backups } = setup({ inGame: 1 });
    const result = await service.request('0.13.0');
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(backups()).toBe(0);
    expect(existsSync(requestFile)).toBe(false);
  });

  it('refuse une seconde demande tant que la première n’est pas faite', async () => {
    const { service } = setup();
    expect((await service.request('0.13.0')).ok).toBe(true);
    expect(await service.request('0.13.0')).toMatchObject({ ok: false, status: 409 });
  });

  it('n’écrit rien si la sauvegarde échoue', async () => {
    const { service, requestFile } = setup({ backupOk: false });
    const result = await service.request('0.13.0');
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(existsSync(requestFile)).toBe(false);
    expect(service.startBlockedReason()).toBeNull();
  });

  it('signale une lecture GitHub en échec au moment de la demande', async () => {
    const { service } = setup({ list: 'not-found' });
    expect(await service.request('0.13.0')).toMatchObject({ ok: false, status: 502 });
  });
});

describe('Annulation', () => {
  it('une demande pas encore prise en charge peut être annulée, et libère les parties', async () => {
    const { service, requestFile } = setup();
    await service.request('0.13.0');
    expect(service.cancel()).toEqual({ ok: true });
    expect(existsSync(requestFile)).toBe(false);
    expect(service.startBlockedReason()).toBeNull();
  });

  it('annuler sans demande renvoie 409', () => {
    const { service } = setup();
    expect(service.cancel()).toMatchObject({ ok: false, status: 409 });
  });

  it('une demande déjà prise en charge par l’hôte ne peut plus être annulée', async () => {
    const { service, requestFile } = setup();
    await service.request('0.13.0');
    // L’hôte renomme la demande dès qu’il la prend en charge.
    const processing = path.join(service.dir, 'request.processing.json');
    writeFileSync(processing, readFileSync(requestFile));
    utimesSync(processing, NOW, NOW);
    rmSync(requestFile);
    expect(service.cancel()).toMatchObject({
      ok: false,
      status: 409,
      error: expect.stringContaining('prise en charge'),
    });
    // Pendant la mise à jour, les parties restent suspendues.
    expect(service.startBlockedReason()).toBe(START_BLOCKED_MESSAGE);
  });

  it('une demande restée « en cours » plus de 45 minutes ne bloque plus les parties', () => {
    const { service } = setup();
    const processing = path.join(service.dir, 'request.processing.json');
    writeFileSync(processing, JSON.stringify({ version: '0.13.0', requestedAt: '', backup: null }));
    utimesSync(processing, new Date(NOW.getTime() - 10 * 60_000), new Date(NOW.getTime() - 10 * 60_000));
    expect(service.startBlockedReason()).toBe(START_BLOCKED_MESSAGE);
    utimesSync(processing, new Date(NOW.getTime() - 50 * 60_000), new Date(NOW.getTime() - 50 * 60_000));
    expect(service.startBlockedReason()).toBeNull();
  });
});

describe('État affiché', () => {
  it('explique pourquoi la mise à jour est impossible : installeur absent, puis partie en cours', async () => {
    const absent = setup({ installed: false });
    expect((await absent.service.view()).blockedReason).toContain('installeur');
    expect((await absent.service.view()).canUpdate).toBe(false);

    const busy = setup({ inGame: 1 });
    const view = await busy.service.view();
    expect(view.blockedReason).toContain('Une partie est en cours');
    expect(view.inGame).toBe(1);
    expect(view.canUpdate).toBe(false);
  });

  it('ouvre la mise à jour quand l’installeur est présent et qu’aucune partie n’est en cours', async () => {
    const { service } = setup();
    const view = await service.view();
    expect(view.canUpdate).toBe(true);
    expect(view.blockedReason).toBeNull();
    expect(view.updater.installed).toBe(true);
  });

  it('écrit le signal de vie du serveur : version, parties en cours, salons ouverts', () => {
    const { service } = setup({ inGame: 1 });
    const stop = service.startHeartbeat();
    try {
      const beat = JSON.parse(readFileSync(path.join(service.dir, 'server-heartbeat.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect(beat).toMatchObject({ version: '0.12.0', inGame: 1, openRooms: 2, updatedAt: NOW.toISOString() });
    } finally {
      stop();
    }
  });
});

describe('Version de l’application', () => {
  it('lit la version du monorepo, depuis n’importe quel dossier du serveur', () => {
    const rootPackage = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../../package.json', import.meta.url)), 'utf8'),
    ) as { version: string };
    expect(readAppVersion(path.dirname(fileURLToPath(import.meta.url)))).toBe(rootPackage.version);
  });
});

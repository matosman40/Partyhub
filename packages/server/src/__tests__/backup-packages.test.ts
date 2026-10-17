import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';
import { readArchive } from '../backup.js';
import { readZip, writeZip, type ZipReadLimits } from '../packages/zip.js';
import { buildPackage } from './helpers/package-kit.js';

/** Sauvegarde complète : chaque version d'un paquet installé, la version active, la restauration. */

const ID = 'paquet-sauvegarde';
const LIMITS: ZipReadLimits = {
  maxEntries: 50_000,
  maxEntryBytes: 512 * 1024 * 1024,
  maxTotalBytes: 528 * 1024 * 1024,
  maxRatio: 200,
  ratioCheckBytes: 1024 * 1024,
};

let server: PartyServer;
let dataDir: string;
let base: string;
let cookie: string;

async function call(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { cookie, ...((init.headers as Record<string, string>) ?? {}) };
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const text = await res.text();
  // Corps de réponse libre : les assertions parcourent le JSON renvoyé par le serveur.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const install = (bytes: Uint8Array) =>
  call('/api/admin/packages', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes });

async function versions(): Promise<Array<{ version: string; active: boolean }>> {
  const res = await call(`/api/admin/packages/${ID}/versions`);
  return res.data?.versions ?? [];
}

async function activeVersion(): Promise<string | undefined> {
  return (await versions()).find((v) => v.active)?.version;
}

async function archive(): Promise<Uint8Array> {
  const res = await fetch(`${base}/api/admin/backup/archive`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return new Uint8Array(await res.arrayBuffer());
}

const restore = (bytes: Uint8Array, query = '') =>
  call(`/api/admin/backup/archive${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: bytes,
  });

const V1 = () => buildPackage({ id: ID, version: '1.0.0' });
const V2 = () => buildPackage({ id: ID, version: '1.1.0' });

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ph-sauvegarde-paquets-'));
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    dbFile: join(dataDir, 'test.db'),
    staticDir: join(dataDir, 'static-absent'),
    adminPassword: 'paquets-sauvegarde-123',
    logLevel: 'silent',
    secureCookies: false,
  };
  server = await createServer({ config, logger: createLogger('silent', true), sweepEveryMs: 0 });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'paquets-sauvegarde-123' }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
});

afterAll(async () => {
  await server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('Sauvegarde complète : paquets installés', () => {
  it('l’archive contient chaque version installée, et indique la version active', async () => {
    expect((await install(V1())).status).toBe(201);
    expect((await install(V2())).status).toBe(201);
    expect(await activeVersion()).toBe('1.1.0');
    expect((await call(`/api/admin/packages/${ID}/versions/1.0.0/activate`, { method: 'POST' })).status).toBe(200);

    const parsed = readArchive(await archive());
    expect(parsed.packages.map((p) => `${p.version}:${p.active}`).sort()).toEqual(['1.0.0:true', '1.1.0:false']);
    expect(parsed.packageFiles.has(`${ID}/1.0.0`)).toBe(true);
    expect(parsed.packageFiles.has(`${ID}/1.1.0`)).toBe(true);
  });

  it('après suppression, la restauration réinstalle les deux versions et rétablit la version active', async () => {
    const bytes = await archive();
    expect((await call(`/api/admin/packages/${ID}`, { method: 'DELETE' })).status).toBe(200);
    expect((await versions()).length).toBe(0);

    const restored = await restore(bytes);
    expect(restored.status).toBe(200);
    expect(restored.data.summary.packages).toBe(2);
    expect(restored.data.summary.skipped).toEqual([]);
    expect(await activeVersion()).toBe('1.0.0');
    expect((await versions()).map((v) => v.version)).toEqual(['1.1.0', '1.0.0']);
  });

  it('une seconde restauration ne réinstalle rien', async () => {
    const restored = await restore(await archive());
    expect(restored.data.summary.packages).toBe(0);
    expect(restored.data.summary.packagesPresent).toBe(2);
  });

  it('en mode « ajouter », la version active déjà en place reste active ; en mode « remplacer », la sauvegarde l’emporte', async () => {
    const bytes = await archive();
    expect((await call(`/api/admin/packages/${ID}/versions/1.1.0/activate`, { method: 'POST' })).status).toBe(200);
    expect(await activeVersion()).toBe('1.1.0');

    await restore(bytes);
    expect(await activeVersion()).toBe('1.1.0');

    await restore(bytes, '?conflict=replace');
    expect(await activeVersion()).toBe('1.0.0');
  });

  it('une version dont l’empreinte ne correspond plus est signalée et non installée', async () => {
    const entries = readZip(await archive(), LIMITS, () => {});
    const list = JSON.parse(
      Buffer.from(entries.find((e) => e.name === 'packages.json')!.data).toString('utf8'),
    ) as Array<{ version: string; sha256: string }>;
    list.find((p) => p.version === '1.1.0')!.sha256 = '0'.repeat(64);
    const tampered = writeZip(
      entries.map((e) =>
        e.name === 'packages.json' ? { name: e.name, data: new TextEncoder().encode(JSON.stringify(list)) } : e,
      ),
    );

    expect((await call(`/api/admin/packages/${ID}`, { method: 'DELETE' })).status).toBe(200);
    const restored = await restore(tampered);
    expect(restored.status).toBe(200);
    expect(restored.data.summary.skipped.join(' ')).toContain('empreinte');
    expect((await versions()).map((v) => v.version)).toEqual(['1.0.0']);
  });
});

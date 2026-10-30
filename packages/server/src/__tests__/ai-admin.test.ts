import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '../config.js';
import { AiRuntime } from '../ai/runtime.js';
import { SecretBox } from '../ai/secrets.js';
import { readStoredAi, AI_SETTINGS_KEY } from '../ai/settings.js';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

/** Clés d'IA saisies dans l'administration : chiffrées, jamais renvoyées, appliquées sans redémarrage. */

const ADMIN_KEY = 'sk-admin-saisie-0001';
const ENV_KEY = 'gsk_environnement_0002';

function memoryKv(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getKv: (key: string) => map.get(key),
    setKv: (key: string, value: string) => void map.set(key, value),
  };
}

function groqFromEnv(): AiConfig {
  return {
    providers: [
      {
        id: 'groq',
        protocol: 'openai',
        apiKey: ENV_KEY,
        model: 'llama-3.3-70b-versatile',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        maxTokensField: 'max_tokens',
        jsonMode: true,
        free: true,
      },
    ],
    timeoutMs: 30000,
    maxCallsPerHour: 300,
  };
}

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ph-ai-admin-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chiffrement des clés', () => {
  it('une valeur chiffrée se relit à l’identique, et ne ressemble pas à la clé', () => {
    const box = new SecretBox(join(dir, 'roundtrip.key'));
    const sealed = box.seal(ADMIN_KEY);
    expect(sealed).not.toContain(ADMIN_KEY);
    expect(box.open(sealed)).toBe(ADMIN_KEY);
    // Windows n’a pas de droits Unix : le fichier y apparaît toujours en 0o666.
    if (process.platform !== 'win32') expect(statSync(join(dir, 'roundtrip.key')).mode & 0o777).toBe(0o600);
  });

  it('sans la clé locale, ou avec une valeur abîmée, rien n’est révélé', () => {
    const box = new SecretBox(join(dir, 'roundtrip.key'));
    const sealed = box.seal(ADMIN_KEY);
    expect(new SecretBox(join(dir, 'absente.key')).open(sealed)).toBeNull();
    expect(box.open(sealed.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBeNull();
    expect(box.open('n’importe quoi')).toBeNull();
  });
});

describe('réglages stockés', () => {
  it('une valeur abîmée est ignorée sans faire échouer', () => {
    expect(readStoredAi('pas du json')).toEqual({});
    expect(readStoredAi(JSON.stringify({ groq: { enabled: 'oui' } }))).toEqual({});
    expect(readStoredAi(JSON.stringify({ groq: { enabled: false } }))).toEqual({ groq: { enabled: false } });
  });
});

describe('configuration en vigueur', () => {
  it('sans environnement ni clé, aucune IA : le jeu prend son histoire de secours', () => {
    const runtime = new AiRuntime(memoryKv(), undefined, dir);
    expect(runtime.available()).toBe(false);
    const status = runtime.status();
    expect(status.chain).toEqual([]);
    expect(status.providers.every((p) => p.keySource === 'none' && !p.active)).toBe(true);
  });

  it('une clé saisie dans l’administration active le fournisseur, sans redémarrage, et n’est jamais relue en clair', () => {
    const kv = memoryKv();
    const runtime = new AiRuntime(kv, undefined, dir);
    const result = runtime.update('mistral', { apiKey: ADMIN_KEY });
    expect(result).toEqual({ changed: ['apiKey'] });
    expect(runtime.available()).toBe(true);
    const mistral = runtime.status().providers.find((p) => p.id === 'mistral');
    expect(mistral).toMatchObject({ keySource: 'admin', active: true, enabled: true, problem: null });
    expect(JSON.stringify(runtime.status())).not.toContain(ADMIN_KEY);
    expect(kv.map.get(AI_SETTINGS_KEY)).toBeDefined();
    expect(kv.map.get(AI_SETTINGS_KEY)).not.toContain(ADMIN_KEY);
  });

  it('la clé de l’administration prime sur celle de l’environnement ; la retirer rend celle de l’environnement', () => {
    const runtime = new AiRuntime(memoryKv(), groqFromEnv(), dir);
    expect(runtime.status().providers.find((p) => p.id === 'groq')?.keySource).toBe('env');
    runtime.update('groq', { apiKey: ADMIN_KEY });
    expect(runtime.status().providers.find((p) => p.id === 'groq')?.keySource).toBe('admin');
    runtime.update('groq', { apiKey: null });
    expect(runtime.status().providers.find((p) => p.id === 'groq')?.keySource).toBe('env');
  });

  it('un fournisseur désactivé sort de la chaîne sans perdre sa clé', () => {
    const runtime = new AiRuntime(memoryKv(), groqFromEnv(), dir);
    runtime.update('groq', { enabled: false });
    expect(runtime.available()).toBe(false);
    const groq = runtime.status().providers.find((p) => p.id === 'groq');
    expect(groq).toMatchObject({ enabled: false, active: false, keySource: 'env' });
    runtime.update('groq', { enabled: true });
    expect(runtime.available()).toBe(true);
  });

  it('« Autre service » sans adresse ni modèle reste inactif, avec la raison affichée', () => {
    const runtime = new AiRuntime(memoryKv(), undefined, dir);
    runtime.update('custom', { apiKey: ADMIN_KEY });
    const custom = runtime.status().providers.find((p) => p.id === 'custom');
    expect(custom?.active).toBe(false);
    expect(custom?.problem).toMatch(/obligatoire/);
    runtime.update('custom', { baseUrl: 'https://ia.exemple.org', model: 'petit-modele' });
    const fixed = runtime.status().providers.find((p) => p.id === 'custom');
    expect(fixed).toMatchObject({ active: true, baseUrl: 'https://ia.exemple.org', model: 'petit-modele' });
  });

  it('la clé chiffrée illisible est signalée, pour être ressaisie', () => {
    const kv = memoryKv();
    const first = new AiRuntime(kv, undefined, dir);
    first.update('openai', { apiKey: ADMIN_KEY });
    rmSync(join(dir, 'ai-secret.key'), { force: true });
    const second = new AiRuntime(kv, undefined, dir);
    const openai = second.status().providers.find((p) => p.id === 'openai');
    expect(openai).toMatchObject({ keySource: 'unreadable', active: false });
    expect(openai?.problem).toMatch(/ressaisissez/);
    expect(existsSync(join(dir, 'ai-secret.key'))).toBe(false);
  });
});

describe('validation des saisies', () => {
  it('refuse une clé avec espace ou trop courte, et une adresse non http pour un fournisseur fixe', () => {
    const runtime = new AiRuntime(memoryKv(), undefined, dir);
    expect(runtime.update('groq', { apiKey: 'avec espace ici' }).error).toMatch(/Clé invalide/);
    expect(runtime.update('groq', { apiKey: 'court' }).error).toMatch(/Clé invalide/);
    expect(runtime.update('groq', { baseUrl: 'https://autre.exemple' }).error).toMatch(/« Autre service »/);
    expect(runtime.update('custom', { baseUrl: 'ftp://nope' }).error).toMatch(/http/);
  });

  it('une clé vide retire la clé saisie', () => {
    const runtime = new AiRuntime(memoryKv(), undefined, dir);
    runtime.update('mistral', { apiKey: ADMIN_KEY });
    runtime.update('mistral', { apiKey: '' });
    expect(runtime.available()).toBe(false);
  });
});

describe('test d’une clé', () => {
  it('une réponse valide est signalée sans rien révéler de la clé', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const runtime = new AiRuntime(memoryKv(), undefined, dir);
    runtime.update('mistral', { apiKey: ADMIN_KEY });
    const result = await runtime.test('mistral');
    expect(result.ok).toBe(true);
    expect(result.message).not.toContain(ADMIN_KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un refus du fournisseur est expliqué par son code, sans son corps ni la clé', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('clé refusée : ' + ADMIN_KEY, { status: 401 })),
    );
    const runtime = new AiRuntime(memoryKv(), undefined, dir);
    runtime.update('mistral', { apiKey: ADMIN_KEY });
    const result = await runtime.test('mistral');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/401/);
    expect(result.message).not.toContain(ADMIN_KEY);
  });

  it('sans clé, le test n’appelle personne', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const runtime = new AiRuntime(memoryKv(), undefined, dir);
    const result = await runtime.test('cerebras');
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('routes de l’administration', () => {
  let server: PartyServer;
  let base: string;
  let cookie = '';
  let serverDir: string;

  beforeAll(async () => {
    serverDir = mkdtempSync(join(tmpdir(), 'ph-ai-routes-'));
    const config: AppConfig = {
      port: 0,
      host: '127.0.0.1',
      dataDir: serverDir,
      dbFile: ':memory:',
      staticDir: '/nonexistent',
      adminPassword: 'mot-de-passe-test-42',
      logLevel: 'silent',
      secureCookies: false,
    };
    server = await createServer({ config, logger: createLogger('silent', true), sweepEveryMs: 0 });
    const port = await server.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${port}`;
    const login = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'mot-de-passe-test-42' }),
    });
    cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  });

  afterAll(async () => {
    await server.close();
    rmSync(serverDir, { recursive: true, force: true });
  });

  it('sans connexion d’administration, rien ne se lit ni ne s’écrit', async () => {
    const res = await fetch(`${base}/api/admin/ai`);
    expect(res.status).toBe(401);
    const put = await fetch(`${base}/api/admin/ai/groq`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: ADMIN_KEY }),
    });
    expect(put.status).toBe(401);
  });

  it('la clé saisie est acceptée, et aucune réponse ne la contient', async () => {
    const put = await fetch(`${base}/api/admin/ai/groq`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ apiKey: ADMIN_KEY }),
    });
    expect(put.status).toBe(200);
    const putText = await put.text();
    expect(putText).not.toContain(ADMIN_KEY);
    const list = await fetch(`${base}/api/admin/ai`, { headers: { cookie } });
    const listText = await list.text();
    expect(list.status).toBe(200);
    expect(listText).not.toContain(ADMIN_KEY);
    const groq = (
      JSON.parse(listText) as { providers: { id: string; keySource: string; active: boolean }[] }
    ).providers.find((p) => p.id === 'groq');
    expect(groq).toMatchObject({ keySource: 'admin', active: true });
  });

  it('une saisie invalide est refusée avec un message, un fournisseur inconnu donne 404', async () => {
    const bad = await fetch(`${base}/api/admin/ai/groq`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ apiKey: 'avec espace' }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: expect.stringMatching(/Clé invalide/) });
    const unknown = await fetch(`${base}/api/admin/ai/inconnu`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ enabled: false }),
    });
    expect(unknown.status).toBe(404);
  });
});

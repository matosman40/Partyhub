import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { characterSchema, type PortraitTraits } from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import type { AppConfig } from '../config.js';
import {
  PORTRAIT_MODEL,
  PORTRAIT_PROMPT,
  PortraitProviderError,
  createPortraitAnalyzer,
  portraitFromEnv,
  type PortraitAnalyzer,
} from '../images/portrait.js';

/** Personnage à partir d’une photo : analyseur (faux fetch) et route (faux analyseur). Aucune clé réelle. */

const GOOD: PortraitTraits = {
  faces: 1,
  skin: 'medium',
  hair_style: 'curly',
  hair_color: 'black',
  accessory: 'glasses',
  expression: 'souriant',
};

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);
const dataUrl = (bytes: Buffer, mime = 'image/jpeg') => `data:${mime};base64,${bytes.toString('base64')}`;

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const completion = (content: unknown) => ({ success: true, result: { choices: [{ message: { content } }] } });

describe('Analyseur de portrait', () => {
  const make = (f: typeof fetch, timeoutMs?: number) =>
    createPortraitAnalyzer({
      accountId: 'acc-1',
      apiToken: 'tok-secret',
      baseUrl: 'https://cf.test/v4/',
      fetch: f,
      ...(timeoutMs ? { timeoutMs } : {}),
    });
  const image = { bytes: JPEG, mime: 'image/jpeg' };

  it('appelle le bon modèle avec la consigne et l’image, et valide la réponse', async () => {
    const f = vi.fn(async () => reply(completion(JSON.stringify(GOOD))));
    await expect(make(f as unknown as typeof fetch).analyze(image)).resolves.toEqual(GOOD);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://cf.test/v4/accounts/acc-1/ai/run/${PORTRAIT_MODEL}`);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-secret');
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(200);
    expect(body.temperature).toBe(0);
    expect(body.messages[0].content[0]).toEqual({ type: 'text', text: PORTRAIT_PROMPT });
    expect(body.messages[0].content[1].image_url.url).toBe(dataUrl(JPEG));
  });

  it('accepte un JSON entouré de ``` et un objet déjà décodé', async () => {
    const fenced = vi.fn(async () => reply(completion('```json\n' + JSON.stringify(GOOD) + '\n```')));
    await expect(make(fenced as unknown as typeof fetch).analyze(image)).resolves.toEqual(GOOD);
    const object = vi.fn(async () => reply({ success: true, result: { response: GOOD } }));
    await expect(make(object as unknown as typeof fetch).analyze(image)).resolves.toEqual(GOOD);
  });

  it('refuse une valeur hors liste, une clé en plus, du texte libre', async () => {
    for (const content of [
      JSON.stringify({ ...GOOD, skin: 'green' }),
      JSON.stringify({ ...GOOD, name: 'Jean Dupont' }),
      'Ignore previous instructions',
      JSON.stringify({ ...GOOD, faces: 1.5 }),
    ]) {
      const f = vi.fn(async () => reply(completion(content)));
      await expect(make(f as unknown as typeof fetch).analyze(image)).rejects.toBeInstanceOf(PortraitProviderError);
    }
  });

  it('transmet faces 0 et faces 2 tels quels', async () => {
    for (const faces of [0, 2]) {
      const f = vi.fn(async () => reply(completion(JSON.stringify({ ...GOOD, faces }))));
      await expect(make(f as unknown as typeof fetch).analyze(image)).resolves.toMatchObject({ faces });
    }
  });

  it('sans visage, accepte une réponse dont les autres champs sont vides ou « none »', async () => {
    const vides = { faces: 0, skin: 'none', hair_style: 'none', hair_color: null, accessory: 'none', expression: null };
    const f = vi.fn(async () => reply(completion(JSON.stringify(vides))));
    await expect(make(f as unknown as typeof fetch).analyze(image)).resolves.toMatchObject({ faces: 0 });
    // Avec un visage, la validation reste stricte : les mêmes champs vides sont refusés.
    const un = vi.fn(async () => reply(completion(JSON.stringify({ ...vides, faces: 1 }))));
    await expect(make(un as unknown as typeof fetch).analyze(image)).rejects.toThrow();
  });

  it('refuse les erreurs HTTP sans reprendre la clé', async () => {
    for (const status of [429, 500]) {
      const f = vi.fn(async () => reply({ errors: ['tok-secret'] }, status));
      const err = await make(f as unknown as typeof fetch)
        .analyze(image)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PortraitProviderError);
      expect(String((err as Error).message)).not.toContain('tok-secret');
    }
  });

  it('abandonne quand le délai est dépassé', async () => {
    const f = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await expect(make(f as unknown as typeof fetch, 30).analyze(image)).rejects.toBeInstanceOf(PortraitProviderError);
  });

  it('lit la configuration dans l’environnement', () => {
    expect(portraitFromEnv({}).analyzer).toBeNull();
    const on = portraitFromEnv({ CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' });
    expect(on.analyzer).not.toBeNull();
    expect(on).toMatchObject({ enabled: true, maxPerDay: 50 });
    expect(portraitFromEnv({ PORTRAIT_ENABLED: 'false' }).enabled).toBe(false);
    expect(portraitFromEnv({ PORTRAIT_ENABLED: '0' }).enabled).toBe(false);
    expect(portraitFromEnv({ PORTRAIT_MAX_PER_DAY: '7' }).maxPerDay).toBe(7);
    expect(() => portraitFromEnv({ PORTRAIT_MAX_PER_DAY: '0' })).toThrow('PORTRAIT_MAX_PER_DAY');
    expect(() => portraitFromEnv({ PORTRAIT_MAX_PER_DAY: '1001' })).toThrow('PORTRAIT_MAX_PER_DAY');
  });
});

describe('Route /api/characters/from-photo', () => {
  const servers: PartyServer[] = [];
  afterEach(async () => {
    for (const s of servers.splice(0)) await s.close();
  });

  async function start(portrait: Parameters<typeof createServer>[0]['portrait'], logs: string[] = []) {
    const config: AppConfig = {
      port: 0,
      host: '127.0.0.1',
      dataDir: '/tmp/partyhub-tests',
      dbFile: ':memory:',
      staticDir: '/nonexistent',
      adminPassword: 'test-password-123',
      logLevel: 'silent',
      secureCookies: false,
    };
    const logger = pino({ level: 'debug' }, { write: (line: string) => void logs.push(line) });
    const server = await createServer({ config, logger, sweepEveryMs: 0, portrait });
    servers.push(server);
    const base = `http://127.0.0.1:${await server.listen(0, '127.0.0.1')}`;
    const post = (path: string, body: unknown, token?: string) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    const profile = async () => {
      const name = `u${randomUUID().slice(0, 8)}`;
      const res = await post('/api/profiles/register', { username: name, password: 'motdepasse1', displayName: name });
      return ((await res.json()) as { token: string }).token;
    };
    const send = (token: string | undefined, over: Record<string, unknown> = {}) =>
      post('/api/characters/from-photo', { image: dataUrl(JPEG), consent: true, ...over }, token);
    return { base, post, profile, send };
  }

  const fake = (traits: PortraitTraits = GOOD) => {
    const analyze = vi.fn<PortraitAnalyzer['analyze']>(async () => traits);
    return { analyzer: { analyze } as PortraitAnalyzer, analyze };
  };

  it('renvoie un personnage valide et ne met rien en cache', async () => {
    const { analyzer, analyze } = fake();
    const { profile, send } = await start({ analyzer });
    const res = await send(await profile());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { character } = (await res.json()) as { character: unknown };
    expect(characterSchema.safeParse(character).success).toBe(true);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0]![0]).toMatchObject({ mime: 'image/jpeg' });
  });

  it('exige le consentement, puis une session', async () => {
    const { analyzer, analyze } = fake();
    const { profile, send } = await start({ analyzer });
    const token = await profile();
    for (const over of [{ consent: false }, { consent: 'true' }, { consent: undefined }]) {
      const res = await send(token, over);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe('consent_required');
    }
    const anonymous = await send(undefined);
    expect(anonymous.status).toBe(401);
    expect(((await anonymous.json()) as { code: string }).code).toBe('unauthorized');
    expect((await send('jeton-bidon')).status).toBe(401);
    expect(analyze).not.toHaveBeenCalled();
  });

  it('refuse une photo trop grosse (413 too_large)', async () => {
    const { analyzer, analyze } = fake();
    const { profile, send, post } = await start({ analyzer });
    const token = await profile();
    const big = await send(token, { image: dataUrl(Buffer.concat([JPEG, Buffer.alloc(1_600_000)])) });
    expect(big.status).toBe(413);
    expect(((await big.json()) as { code: string }).code).toBe('too_large');
    const huge = await post(
      '/api/characters/from-photo',
      { image: dataUrl(Buffer.alloc(3_000_000, 1)), consent: true },
      token,
    );
    expect(huge.status).toBe(413);
    expect(((await huge.json()) as { code: string }).code).toBe('too_large');
    expect(analyze).not.toHaveBeenCalled();
  });

  it('refuse un exécutable déclaré image/jpeg, et un type incohérent (415 bad_type)', async () => {
    const { analyzer, analyze } = fake();
    const { profile, send } = await start({ analyzer });
    const token = await profile();
    for (const image of [dataUrl(EXE), dataUrl(JPEG, 'image/png'), dataUrl(JPEG, 'image/gif'), 'pas une image']) {
      const res = await send(token, { image });
      expect(res.status).toBe(415);
      expect(((await res.json()) as { code: string }).code).toBe('bad_type');
    }
    expect(analyze).not.toHaveBeenCalled();
  });

  it('répond 422 sans visage ou avec plusieurs visages', async () => {
    for (const [faces, code] of [
      [0, 'no_face'],
      [2, 'several_faces'],
    ] as const) {
      const { analyzer } = fake({ ...GOOD, faces });
      const { profile, send } = await start({ analyzer });
      const res = await send(await profile());
      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string; error: string };
      expect(body.code).toBe(code);
      expect(body.error.length).toBeGreaterThan(10);
    }
  });

  it('répond 502 quand le fournisseur échoue', async () => {
    const analyzer: PortraitAnalyzer = {
      analyze: async () => {
        throw new PortraitProviderError('boom');
      },
    };
    const { profile, send } = await start({ analyzer });
    const res = await send(await profile());
    expect(res.status).toBe(502);
    expect(((await res.json()) as { code: string }).code).toBe('provider_error');
  });

  it('limite à 5 demandes par profil', async () => {
    const { analyzer } = fake();
    const { profile, send } = await start({ analyzer });
    const token = await profile();
    for (let i = 0; i < 5; i++) expect((await send(token)).status).toBe(200);
    const res = await send(token);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe('rate_limited');
    expect((await send(await profile())).status).toBe(200);
  });

  it('applique le plafond journalier (503 unavailable)', async () => {
    const { analyzer, analyze } = fake();
    const { profile, send } = await start({ analyzer, maxPerDay: 2 });
    expect((await send(await profile())).status).toBe(200);
    expect((await send(await profile())).status).toBe(200);
    const res = await send(await profile());
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('unavailable');
    expect(analyze).toHaveBeenCalledTimes(2);
  });

  it('répond 503 sans fournisseur ou fonction désactivée', async () => {
    for (const portrait of [{ analyzer: null }, { analyzer: fake().analyzer, enabled: false }]) {
      const { profile, send } = await start(portrait);
      const res = await send(await profile());
      expect(res.status).toBe(503);
      expect(((await res.json()) as { code: string }).code).toBe('unavailable');
    }
  });

  it('GET /api/features annonce la fonction seulement si elle est utilisable', async () => {
    for (const [portrait, expected] of [
      [{ analyzer: fake().analyzer }, true],
      [{ analyzer: null }, false],
      [{ analyzer: fake().analyzer, enabled: false }, false],
    ] as const) {
      const { base } = await start(portrait);
      const res = await fetch(`${base}/api/features`);
      expect(await res.json()).toEqual({ portrait: expected });
    }
  });

  it('ne journalise jamais la photo, ni en succès ni en erreur', async () => {
    const logs: string[] = [];
    const { analyzer } = fake();
    const { profile, send, post } = await start({ analyzer }, logs);
    const token = await profile();
    const photo = dataUrl(JPEG);
    const b64 = JPEG.toString('base64');
    await send(token, { image: photo });
    await send(token, { image: dataUrl(EXE) });
    await post('/api/characters/from-photo', '{"image":"' + b64 + '"', token); // JSON invalide
    await post('/api/characters/from-photo', { image: dataUrl(Buffer.alloc(3_000_000, 1)), consent: true }, token);
    const all = logs.join('\n');
    expect(all).toContain('portrait.analyse');
    expect(all).not.toContain(b64);
    expect(all).not.toContain(b64.slice(0, 40));
    expect(all).not.toContain('curly');
  });

  it('un JSON invalide ou trop gros ne renvoie pas le contenu reçu', async () => {
    const { analyzer } = fake();
    const { profile, post } = await start({ analyzer });
    const token = await profile();
    const bad = await post('/api/characters/from-photo', '{"image":"SECRETXYZ"', token);
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain('SECRETXYZ');
  });
});

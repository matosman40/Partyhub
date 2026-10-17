import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../db/store.js';
import { POOL_MAX, createGameImages, gameImageUrl } from '../images/game-images.js';
import { ImageLibrary } from '../images/library.js';
import {
  ImageError,
  MAX_IMAGE_BYTES,
  checkImage,
  createCloudflareProvider,
  createModelScopeProvider,
  sniffImage,
  type GeneratedImage,
  type ImageProvider,
} from '../images/providers.js';
import { buildImageProviders, imagesFromEnv } from '../images/config.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(16)]);

const signal = (): AbortSignal => new AbortController().signal;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const imageResponse = (bytes: Buffer, type: string): Response =>
  new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': type } });

interface Call {
  url: string;
  init?: RequestInit;
}

/** Faux `fetch` : garde la trace des appels, et répond selon `respond`. */
function scriptedFetch(respond: (url: string) => Response): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(init ? { url, init } : { url });
    return respond(url);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

/** Attend l'échec d'une promesse, et renvoie l'erreur. */
async function failureOf(promise: Promise<unknown>): Promise<ImageError> {
  const err = await promise.then(
    () => {
      throw new Error('la promesse aurait dû échouer');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ImageError);
  return err as ImageError;
}

describe('reconnaissance et vérification des images', () => {
  it('reconnaît PNG, JPEG et WebP, et refuse le reste', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(WEBP)).toBe('image/webp');
    expect(sniffImage(Buffer.from('<html>oops</html>'))).toBeNull();
  });

  it('une image vide ou trop grosse est refusée', () => {
    expect(() => checkImage(Buffer.alloc(0))).toThrow('vide');
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]);
    expect(() => checkImage(big)).toThrow('trop volumineuse');
  });
});

describe('Cloudflare Workers AI', () => {
  const base = 'https://cf.test/client/v4';
  const expectedUrl = `${base}/accounts/acc-1/ai/run/@cf/black-forest-labs/flux-1-schnell`;

  it('une réponse image brute est gardée telle quelle, avec la clé dans l’en-tête', async () => {
    const { fetch: f, calls } = scriptedFetch(() => imageResponse(PNG, 'image/png'));
    const provider = createCloudflareProvider({ accountId: 'acc-1', apiToken: 'tok-1', baseUrl: base, fetch: f });
    const out = await provider.generate('un phare', signal());
    expect(out.mime).toBe('image/png');
    expect(out.bytes.equals(PNG)).toBe(true);
    expect(calls[0]!.url).toBe(expectedUrl);
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ prompt: 'un phare', steps: 4 });
    expect((calls[0]!.init?.headers as Record<string, string>).authorization).toBe('Bearer tok-1');
  });

  it('une enveloppe JSON avec l’image en base64 est décodée', async () => {
    const { fetch: f } = scriptedFetch(() => json({ success: true, result: { image: JPEG.toString('base64') } }));
    const provider = createCloudflareProvider({ accountId: 'acc-1', apiToken: 'tok', baseUrl: base, fetch: f });
    const out = await provider.generate('un phare', signal());
    expect(out.mime).toBe('image/jpeg');
    expect(out.bytes.equals(JPEG)).toBe(true);
  });

  it('une réponse sans image est un échec', async () => {
    const { fetch: f } = scriptedFetch(() => json({ result: {} }));
    const provider = createCloudflareProvider({ accountId: 'acc-1', apiToken: 'tok', baseUrl: base, fetch: f });
    const err = await failureOf(provider.generate('x', signal()));
    expect(err.message).toContain('sans image');
  });

  it('un statut 429 ou 5xx est réessayable, un 400 ne l’est pas', async () => {
    const limited = createCloudflareProvider({
      accountId: 'acc-1',
      apiToken: 'tok',
      baseUrl: base,
      fetch: scriptedFetch(() => new Response('', { status: 429 })).fetch,
    });
    expect((await failureOf(limited.generate('x', signal()))).retryable).toBe(true);

    const rejected = createCloudflareProvider({
      accountId: 'acc-1',
      apiToken: 'tok',
      baseUrl: base,
      fetch: scriptedFetch(() => new Response('', { status: 400 })).fetch,
    });
    expect((await failureOf(rejected.generate('x', signal()))).retryable).toBe(false);
  });

  it('le message d’erreur ne contient ni la clé ni le corps de la réponse', async () => {
    const { fetch: f } = scriptedFetch(() => new Response('secret-corps tok-secret', { status: 500 }));
    const provider = createCloudflareProvider({ accountId: 'acc-1', apiToken: 'tok-secret', baseUrl: base, fetch: f });
    const err = await failureOf(provider.generate('x', signal()));
    expect(err.message).not.toContain('tok-secret');
    expect(err.message).not.toContain('secret-corps');
  });

  it('une réponse qui n’est pas une image est refusée', async () => {
    const { fetch: f } = scriptedFetch(() => imageResponse(Buffer.from('<html>oops</html>'), 'image/png'));
    const provider = createCloudflareProvider({ accountId: 'acc-1', apiToken: 'tok', baseUrl: base, fetch: f });
    const err = await failureOf(provider.generate('x', signal()));
    expect(err.message).toContain('pas une image');
  });
});

describe('ModelScope (Qwen-Image)', () => {
  const base = 'https://ms.test';
  const submitUrl = `${base}/v1/images/generations`;

  it('soumet la tâche, attend qu’elle réussisse, puis télécharge l’image', async () => {
    let polls = 0;
    const { fetch: f, calls } = scriptedFetch((url) => {
      if (url === submitUrl) return json({ task_id: 'task-9' });
      if (url === `${base}/v1/tasks/task-9`) {
        polls += 1;
        return polls < 2
          ? json({ task_status: 'PROCESSING' })
          : json({ task_status: 'SUCCEED', output_images: ['https://cdn.test/out.png'] });
      }
      return imageResponse(PNG, 'image/png');
    });
    const sleeps: number[] = [];
    const provider = createModelScopeProvider({
      apiKey: 'ms-key',
      baseUrl: base,
      pollMs: 7,
      fetch: f,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const out = await provider.generate('un phare', signal());
    expect(out.mime).toBe('image/png');
    expect(out.bytes.equals(PNG)).toBe(true);
    expect(sleeps).toEqual([7]);
    expect(calls[0]!.init?.headers).toMatchObject({ 'x-modelscope-async-mode': 'true' });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ model: 'Qwen/Qwen-Image-2.1', prompt: 'un phare' });
    expect(calls.at(-1)!.url).toBe('https://cdn.test/out.png');
  });

  it('une tâche en échec est refusée, sans nouvelle tentative', async () => {
    const { fetch: f } = scriptedFetch((url) =>
      url === submitUrl ? json({ task_id: 't' }) : json({ task_status: 'FAILED' }),
    );
    const provider = createModelScopeProvider({ apiKey: 'k', baseUrl: base, pollMs: 1, fetch: f });
    const err = await failureOf(provider.generate('x', signal()));
    expect(err.message).toContain('refusé ou échoué');
    expect(err.retryable).toBe(false);
  });

  it('sans identifiant de tâche, la soumission est un échec', async () => {
    const { fetch: f } = scriptedFetch(() => json({}));
    const provider = createModelScopeProvider({ apiKey: 'k', baseUrl: base, fetch: f });
    const err = await failureOf(provider.generate('x', signal()));
    expect(err.message).toContain('pas renvoyé de tâche');
  });

  it('une erreur du service à la soumission est réessayable', async () => {
    const { fetch: f } = scriptedFetch(() => new Response('', { status: 503 }));
    const provider = createModelScopeProvider({ apiKey: 'k', baseUrl: base, fetch: f });
    expect((await failureOf(provider.generate('x', signal()))).retryable).toBe(true);
  });

  it('une génération annulée pendant l’attente n’est pas réessayée', async () => {
    const controller = new AbortController();
    const { fetch: f } = scriptedFetch((url) => {
      if (url === submitUrl) return json({ task_id: 't' });
      controller.abort();
      return json({ task_status: 'PROCESSING' });
    });
    const provider = createModelScopeProvider({ apiKey: 'k', baseUrl: base, pollMs: 1, fetch: f });
    const err = await failureOf(provider.generate('x', controller.signal));
    expect(err.message).toContain('annulée');
    expect(err.retryable).toBe(false);
  });
});

describe('configuration des fournisseurs d’images', () => {
  it('sans clé, aucun fournisseur : la fonction reste désactivée, sans erreur', () => {
    expect(imagesFromEnv({})).toEqual({ providers: [], maxPerDay: 150, timeoutMs: 60_000 });
  });

  it('les fournisseurs dont la clé est présente sont utilisés, Cloudflare d’abord', () => {
    const config = imagesFromEnv({
      MODELSCOPE_API_KEY: 'ms',
      CLOUDFLARE_ACCOUNT_ID: 'acc',
      CLOUDFLARE_API_TOKEN: 'cf',
    });
    expect(config.providers.map((p) => p.id)).toEqual(['cloudflare', 'modelscope']);
  });

  it('IMAGE_PROVIDERS fixe l’ordre d’appel', () => {
    const config = imagesFromEnv({
      IMAGE_PROVIDERS: 'modelscope,cloudflare',
      MODELSCOPE_API_KEY: 'ms',
      CLOUDFLARE_ACCOUNT_ID: 'acc',
      CLOUDFLARE_API_TOKEN: 'cf',
    });
    expect(config.providers.map((p) => p.id)).toEqual(['modelscope', 'cloudflare']);
  });

  it('Cloudflare exige le compte et le jeton : sans l’un des deux, il est absent', () => {
    expect(imagesFromEnv({ CLOUDFLARE_API_TOKEN: 'cf' }).providers).toEqual([]);
    expect(imagesFromEnv({ CLOUDFLARE_ACCOUNT_ID: 'acc' }).providers).toEqual([]);
  });

  it('demander un fournisseur sans sa clé est une erreur de configuration', () => {
    expect(() => imagesFromEnv({ IMAGE_PROVIDERS: 'modelscope' })).toThrow('clé est absente');
  });

  it('un fournisseur inconnu est une erreur de configuration', () => {
    expect(() => imagesFromEnv({ IMAGE_PROVIDERS: 'dalle' })).toThrow('invalide');
  });

  it('les plafonds se règlent par variable, et refusent les valeurs absurdes', () => {
    expect(imagesFromEnv({ IMAGE_MAX_PER_DAY: '20', IMAGE_TIMEOUT_MS: '30000' })).toMatchObject({
      maxPerDay: 20,
      timeoutMs: 30_000,
    });
    expect(() => imagesFromEnv({ IMAGE_MAX_PER_DAY: '0' })).toThrow('IMAGE_MAX_PER_DAY');
    expect(() => imagesFromEnv({ IMAGE_TIMEOUT_MS: 'abc' })).toThrow('IMAGE_TIMEOUT_MS');
  });

  it('buildImageProviders crée les fournisseurs dans l’ordre de la configuration', () => {
    const config = imagesFromEnv({
      IMAGE_PROVIDERS: 'modelscope,cloudflare',
      MODELSCOPE_API_KEY: 'ms',
      CLOUDFLARE_ACCOUNT_ID: 'acc',
      CLOUDFLARE_API_TOKEN: 'cf',
    });
    expect(buildImageProviders(config).map((p) => p.id)).toEqual(['modelscope', 'cloudflare']);
  });
});

describe('bibliothèque d’images', () => {
  const opened: Store[] = [];
  afterEach(() => {
    for (const store of opened.splice(0)) store.close();
  });

  function libraryAt(now: () => Date = () => new Date('2026-10-16T10:00:00Z')) {
    const store = new Store(':memory:');
    opened.push(store);
    return { store, library: new ImageLibrary(store, now) };
  }

  const picture = (): GeneratedImage => ({ bytes: PNG, mime: 'image/png' });

  it('une image gardée se retrouve par identifiant, avec son type et son contenu', () => {
    const { library } = libraryAt();
    const saved = library.add({
      kind: 'portrait',
      tag: 'vaisseau',
      prompt: 'un capitaine',
      provider: 'cloudflare',
      image: picture(),
    });
    expect(saved.id).toMatch(/^[a-f0-9]{24}$/);
    const data = library.data(saved.id);
    expect(data?.mime).toBe('image/png');
    expect(data?.bytes.equals(PNG)).toBe(true);
    expect(library.data('0'.repeat(24))).toBeNull();
  });

  it('les images se rangent par catégorie et par thème', () => {
    const { library } = libraryAt();
    const base = { prompt: 'x', provider: 'cloudflare', image: picture() };
    library.add({ ...base, kind: 'portrait', tag: 'vaisseau' });
    library.add({ ...base, kind: 'fond', tag: 'vaisseau' });
    library.add({ ...base, kind: 'portrait', tag: 'foret' });
    expect(library.count('portrait', 'vaisseau')).toBe(1);
    expect(library.count('fond', 'vaisseau')).toBe(1);
    expect(library.list('portrait', 'foret')).toHaveLength(1);
    expect(library.count('fond', 'foret')).toBe(0);
  });

  it('la liste suit l’ordre de création, les plus anciennes d’abord', () => {
    let tick = 0;
    const { library } = libraryAt(() => new Date(Date.UTC(2026, 9, 16, 10, 0, tick++)));
    const base = { kind: 'portrait' as const, tag: 'v', prompt: 'x', provider: 'cloudflare', image: picture() };
    const first = library.add(base);
    const second = library.add(base);
    expect(library.list('portrait', 'v').map((i) => i.id)).toEqual([first.id, second.id]);
  });

  it('le compteur du jour augmente à chaque génération, et repart à zéro le lendemain', () => {
    const { store } = libraryAt();
    let day = new Date('2026-10-16T23:59:00Z');
    const library = new ImageLibrary(store, () => day);
    expect(library.usedToday()).toBe(0);
    library.recordUse();
    library.recordUse();
    expect(library.usedToday()).toBe(2);
    day = new Date('2026-10-17T00:01:00Z');
    expect(library.usedToday()).toBe(0);
  });

  it('un compteur du jour abîmé repart à zéro au lieu de bloquer les images', () => {
    const { store, library } = libraryAt();
    store.setKv('ai-images:usage:2026-10-16', 'n’importe quoi');
    expect(library.usedToday()).toBe(0);
  });
});

describe('ctx.images : demandes des jeux', () => {
  const opened: Store[] = [];
  afterEach(() => {
    for (const store of opened.splice(0)) store.close();
  });

  interface Seen {
    provider: string;
    prompt: string;
  }

  function fakeProvider(id: ImageProvider['id'], outcome: 'ok' | 'fail', seen: Seen[]): ImageProvider {
    return {
      id,
      label: id,
      async generate(prompt) {
        seen.push({ provider: id, prompt });
        if (outcome === 'fail') throw new ImageError('panne', true);
        return { bytes: PNG, mime: 'image/png' };
      },
    };
  }

  function imagesWith(providers: ImageProvider[], options: { maxPerDay?: number; poolMax?: typeof POOL_MAX } = {}) {
    const store = new Store(':memory:');
    opened.push(store);
    const library = new ImageLibrary(store);
    const images = createGameImages({
      providers,
      library,
      maxPerDay: options.maxPerDay ?? 100,
      timeoutMs: 5_000,
      poolMax: options.poolMax ?? POOL_MAX,
    });
    return { images, library };
  }

  it('sans fournisseur, rien n’est généré : le jeu garde son rendu de secours', async () => {
    const { images } = imagesWith([]);
    expect(images.available()).toBe(false);
    expect(await images.generate({ kind: 'portrait', prompt: 'un capitaine', tag: 'v' })).toBeNull();
  });

  it('un fournisseur en panne laisse la place au suivant, et l’image garde son fournisseur', async () => {
    const seen: Seen[] = [];
    const { images, library } = imagesWith([
      fakeProvider('cloudflare', 'fail', seen),
      fakeProvider('modelscope', 'ok', seen),
    ]);
    const image = await images.generate({ kind: 'portrait', prompt: 'un capitaine', tag: 'v' });
    expect(image?.url).toBe(gameImageUrl(image!.id));
    expect(seen.map((s) => s.provider)).toEqual(['cloudflare', 'modelscope']);
    expect(library.list('portrait', 'v')[0]!.provider).toBe('modelscope');
  });

  it('si tous les fournisseurs échouent, rien n’est gardé et le compteur du jour ne bouge pas', async () => {
    const seen: Seen[] = [];
    const { images, library } = imagesWith([fakeProvider('cloudflare', 'fail', seen)]);
    expect(await images.generate({ kind: 'portrait', prompt: 'x', tag: 'v' })).toBeNull();
    expect(library.count('portrait', 'v')).toBe(0);
    expect(library.usedToday()).toBe(0);
  });

  it('le plafond journalier coupe les demandes suivantes, sans appeler les fournisseurs', async () => {
    const seen: Seen[] = [];
    const { images } = imagesWith([fakeProvider('cloudflare', 'ok', seen)], { maxPerDay: 1 });
    expect(await images.generate({ kind: 'portrait', prompt: 'un', tag: 'v' })).not.toBeNull();
    expect(await images.generate({ kind: 'portrait', prompt: 'deux', tag: 'v' })).toBeNull();
    expect(seen).toHaveLength(1);
  });

  it('le plafond par thème et par catégorie est respecté, chaque thème a le sien', async () => {
    const seen: Seen[] = [];
    const { images } = imagesWith([fakeProvider('cloudflare', 'ok', seen)], {
      poolMax: { portrait: 2, fond: 1 },
    });
    expect(await images.generate({ kind: 'portrait', prompt: '1', tag: 'v' })).not.toBeNull();
    expect(await images.generate({ kind: 'portrait', prompt: '2', tag: 'v' })).not.toBeNull();
    expect(await images.generate({ kind: 'portrait', prompt: '3', tag: 'v' })).toBeNull();
    expect(await images.generate({ kind: 'fond', prompt: '4', tag: 'v' })).not.toBeNull();
    expect(await images.generate({ kind: 'fond', prompt: '5', tag: 'v' })).toBeNull();
    expect(await images.generate({ kind: 'portrait', prompt: '6', tag: 'autre' })).not.toBeNull();
  });

  it('une description vide n’appelle personne, et une description trop longue est coupée', async () => {
    const seen: Seen[] = [];
    const { images } = imagesWith([fakeProvider('cloudflare', 'ok', seen)]);
    expect(await images.generate({ kind: 'portrait', prompt: '   ', tag: 'v' })).toBeNull();
    expect(seen).toHaveLength(0);
    await images.generate({ kind: 'portrait', prompt: 'x'.repeat(1500), tag: 'v' });
    expect(seen[0]!.prompt.length).toBe(1000);
  });

  it('une demande déjà annulée n’appelle personne', async () => {
    const seen: Seen[] = [];
    const { images } = imagesWith([fakeProvider('cloudflare', 'ok', seen)]);
    const controller = new AbortController();
    controller.abort();
    expect(await images.generate({ kind: 'portrait', prompt: 'x', tag: 'v', signal: controller.signal })).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it('list renvoie les adresses publiques des images du thème', async () => {
    const seen: Seen[] = [];
    const { images } = imagesWith([fakeProvider('cloudflare', 'ok', seen)]);
    const made = await images.generate({ kind: 'fond', prompt: 'un port', tag: 'v' });
    expect(images.list('fond', 'v')).toEqual([{ id: made!.id, kind: 'fond', tag: 'v', url: gameImageUrl(made!.id) }]);
  });
});

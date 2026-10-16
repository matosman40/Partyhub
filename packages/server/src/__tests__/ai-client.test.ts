import { describe, expect, it } from 'vitest';
import { AiError, buildRequest, createAiClient, extractAnthropicText, extractOpenAiText } from '../ai/client.js';
import type { AiConfig, AiProviderConfig } from '../config.js';

const KEY = 'sk-test-secret-key-123';

/** Anthropic, avec les réglages qu'applique la configuration réelle. */
function anthropic(overrides: Partial<AiProviderConfig> = {}): AiProviderConfig {
  return {
    id: 'anthropic',
    protocol: 'anthropic',
    apiKey: KEY,
    model: 'claude-haiku-5-5',
    endpoint: 'https://api.anthropic.com/v1/messages',
    maxTokensField: 'max_tokens',
    jsonMode: false,
    free: false,
    ...overrides,
  };
}

/** OpenAI, avec les réglages qu'applique la configuration réelle. */
function openai(overrides: Partial<AiProviderConfig> = {}): AiProviderConfig {
  return {
    id: 'openai',
    protocol: 'openai',
    apiKey: KEY,
    model: 'gpt-4o-mini',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    maxTokensField: 'max_completion_tokens',
    jsonMode: true,
    free: false,
    ...overrides,
  };
}

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return { providers: [anthropic()], timeoutMs: 1000, maxCallsPerHour: 100, ...overrides };
}

interface Call {
  url: string;
  init: RequestInit;
}

/** Faux fetch : chaque appel consomme la prochaine réponse de la liste. */
function fakeFetch(responses: (() => Response | Promise<Response>)[]) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('plus de réponse prévue');
    return next();
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const anthropicOk = (text: string) => () => json(200, { content: [{ type: 'text', text }] });
const openaiOk = (text: string) => () => json(200, { choices: [{ message: { content: text } }] });

const noSleep = async () => {};

/** Un fetch qui ne répond jamais : il ne rend la main qu'à l'annulation. */
const hang = (_url: string, init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });

describe('requêtes des fournisseurs', () => {
  it('Anthropic : endpoint Messages, en-têtes et corps attendus', () => {
    const req = buildRequest(anthropic(), { system: 'SYS', user: 'USER', maxTokens: 800 });
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
    expect(req.init.headers).toMatchObject({ 'x-api-key': KEY, 'anthropic-version': '2023-06-01' });
    const body = JSON.parse(req.init.body);
    expect(body).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 800,
      system: 'SYS',
      messages: [{ role: 'user', content: 'USER' }],
    });
  });

  it('OpenAI : endpoint chat, jeton Bearer et réponse en JSON', () => {
    const req = buildRequest(openai(), { system: 'SYS', user: 'USER', maxTokens: 500 });
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(req.init.headers).toMatchObject({ authorization: `Bearer ${KEY}` });
    const body = JSON.parse(req.init.body);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.max_completion_tokens).toBe(500);
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USER' },
    ]);
  });

  it('un fournisseur compatible sans mode JSON ni max_completion_tokens reçoit max_tokens seulement', () => {
    const mistral = openai({
      id: 'mistral',
      endpoint: 'https://api.mistral.ai/v1/chat/completions',
      maxTokensField: 'max_tokens',
      jsonMode: false,
    });
    const body = JSON.parse(buildRequest(mistral, { system: 's', user: 'u', maxTokens: 300 }).init.body);
    expect(body.max_tokens).toBe(300);
    expect(body).not.toHaveProperty('max_completion_tokens');
    expect(body).not.toHaveProperty('response_format');
  });

  it('extrait le texte des deux formats de réponse', () => {
    expect(
      extractAnthropicText({
        content: [{ type: 'text', text: 'ab' }, { type: 'tool_use' }, { type: 'text', text: 'c' }],
      }),
    ).toBe('abc');
    expect(extractAnthropicText({})).toBe('');
    expect(extractOpenAiText({ choices: [{ message: { content: '{"x":1}' } }] })).toBe('{"x":1}');
    expect(extractOpenAiText({ choices: [] })).toBe('');
  });
});

describe('appels', () => {
  it('renvoie le texte de la réponse', async () => {
    const f = fakeFetch([anthropicOk('{"titre":"Ok"}')]);
    const client = createAiClient({ config: config(), fetch: f.fetch, sleep: noSleep });
    await expect(client.complete({ system: 's', user: 'u', maxTokens: 10 })).resolves.toBe('{"titre":"Ok"}');
    expect(f.calls).toHaveLength(1);
  });

  it('OpenAI : renvoie le texte du premier choix', async () => {
    const f = fakeFetch([openaiOk('{"titre":"Ok"}')]);
    const client = createAiClient({ config: config({ providers: [openai()] }), fetch: f.fetch, sleep: noSleep });
    await expect(client.complete({ system: 's', user: 'u', maxTokens: 10 })).resolves.toBe('{"titre":"Ok"}');
    expect(f.calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('relance une fois après une erreur 503, puis réussit', async () => {
    const f = fakeFetch([() => json(503, {}), anthropicOk('ok')]);
    let slept = 0;
    const client = createAiClient({
      config: config(),
      fetch: f.fetch,
      sleep: async () => {
        slept += 1;
      },
    });
    await expect(client.complete({ system: 's', user: 'u', maxTokens: 10 })).resolves.toBe('ok');
    expect(f.calls).toHaveLength(2);
    expect(slept).toBe(1);
  });

  it('ne relance pas une erreur 400 (requête refusée)', async () => {
    const f = fakeFetch([() => json(400, { error: 'mauvaise requête' })]);
    const client = createAiClient({ config: config(), fetch: f.fetch, sleep: noSleep });
    const err = await client.complete({ system: 's', user: 'u', maxTokens: 10 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).retryable).toBe(false);
    expect((err as AiError).status).toBe(400);
    expect(f.calls).toHaveLength(1);
  });

  it('abandonne après deux échecs transitoires', async () => {
    const f = fakeFetch([() => json(429, {}), () => json(500, {})]);
    const client = createAiClient({ config: config(), fetch: f.fetch, sleep: noSleep });
    await expect(client.complete({ system: 's', user: 'u', maxTokens: 10 })).rejects.toBeInstanceOf(AiError);
    expect(f.calls).toHaveLength(2);
  });

  it('une réponse vide est traitée comme une erreur transitoire', async () => {
    const f = fakeFetch([() => json(200, { content: [] }), () => json(200, { content: [] })]);
    const client = createAiClient({ config: config(), fetch: f.fetch, sleep: noSleep });
    await expect(client.complete({ system: 's', user: 'u', maxTokens: 10 })).rejects.toThrow('Réponse vide');
    expect(f.calls).toHaveLength(2);
  });

  it('refuse au-delà de la limite horaire, sans appeler le fournisseur, puis reprend une heure plus tard', async () => {
    let t = 0;
    const f = fakeFetch([anthropicOk('a'), anthropicOk('b'), anthropicOk('c')]);
    const client = createAiClient({
      config: config({ maxCallsPerHour: 2 }),
      fetch: f.fetch,
      sleep: noSleep,
      now: () => t,
    });
    await client.complete({ system: 's', user: 'u', maxTokens: 10 });
    await client.complete({ system: 's', user: 'u', maxTokens: 10 });
    await expect(client.complete({ system: 's', user: 'u', maxTokens: 10 })).rejects.toThrow('Limite d’appels');
    expect(f.calls).toHaveLength(2);

    // Les deux premiers appels sont sortis de la fenêtre d'une heure : le troisième passe.
    t = 60 * 60 * 1000 + 1;
    await expect(client.complete({ system: 's', user: 'u', maxTokens: 10 })).resolves.toBe('c');
    expect(f.calls).toHaveLength(3);
  });

  it('un délai dépassé est reconnu, et la clé n’apparaît jamais dans le message', async () => {
    const f = { fetch: hang as unknown as typeof fetch };
    const client = createAiClient({ config: config({ timeoutMs: 5 }), fetch: f.fetch, sleep: noSleep });
    const err = await client.complete({ system: 's', user: 'u', maxTokens: 10 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).message).toBe('Délai dépassé pour l’IA.');
    expect((err as AiError).message).not.toContain(KEY);
  });

  it('une annulation de la salle arrête l’appel sans nouvelle tentative', async () => {
    let calls = 0;
    const client = createAiClient({
      config: config({ timeoutMs: 5000 }),
      fetch: ((url: string, init: RequestInit) => {
        calls += 1;
        return hang(url, init);
      }) as typeof fetch,
      sleep: noSleep,
    });
    const controller = new AbortController();
    const pending = client.complete({ system: 's', user: 'u', maxTokens: 10, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('Génération annulée.');
    expect(calls).toBe(1);
  });

  it('les erreurs réseau ne révèlent pas la clé', async () => {
    const f = {
      fetch: (async () => {
        throw new Error(`socket ${KEY}`);
      }) as unknown as typeof fetch,
    };
    const client = createAiClient({ config: config(), fetch: f.fetch, sleep: noSleep });
    const err = await client.complete({ system: 's', user: 'u', maxTokens: 10 }).catch((e: unknown) => e);
    expect((err as AiError).message).toBe('Connexion au fournisseur d’IA impossible.');
    expect((err as AiError).message).not.toContain(KEY);
  });
});

describe('plusieurs fournisseurs', () => {
  it('un fournisseur en échec laisse la place au suivant, après sa propre relance', async () => {
    const f = fakeFetch([() => json(500, {}), () => json(500, {}), openaiOk('ok')]);
    const client = createAiClient({
      config: config({ providers: [anthropic(), openai()] }),
      fetch: f.fetch,
      sleep: noSleep,
    });
    await expect(client.complete({ system: 's', user: 'u', maxTokens: 10 })).resolves.toBe('ok');
    expect(f.calls).toHaveLength(3);
    expect(f.calls[2]!.url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('un fournisseur qui refuse la requête (400) laisse aussi la place au suivant', async () => {
    const f = fakeFetch([() => json(400, {}), openaiOk('ok')]);
    const client = createAiClient({
      config: config({ providers: [anthropic(), openai()] }),
      fetch: f.fetch,
      sleep: noSleep,
    });
    await expect(client.complete({ system: 's', user: 'u', maxTokens: 10 })).resolves.toBe('ok');
    expect(f.calls).toHaveLength(2);
  });

  it('un fournisseur à son plafond journalier est sauté, sans appel', async () => {
    const f = fakeFetch([anthropicOk('a'), openaiOk('b')]);
    const client = createAiClient({
      config: config({ providers: [anthropic({ maxCallsPerDay: 1 }), openai()] }),
      fetch: f.fetch,
      sleep: noSleep,
    });
    await expect(client.complete({ system: 's', user: 'u', maxTokens: 10 })).resolves.toBe('a');
    await expect(client.complete({ system: 's', user: 'u', maxTokens: 10 })).resolves.toBe('b');
    expect(f.calls.map((c) => c.url)).toEqual([
      'https://api.anthropic.com/v1/messages',
      'https://api.openai.com/v1/chat/completions',
    ]);
  });

  it('quand tous les fournisseurs sont à leur plafond, l’appel est refusé sans rien envoyer', async () => {
    const f = fakeFetch([anthropicOk('a')]);
    const client = createAiClient({
      config: config({ providers: [anthropic({ maxCallsPerDay: 1 })] }),
      fetch: f.fetch,
      sleep: noSleep,
    });
    await client.complete({ system: 's', user: 'u', maxTokens: 10 });
    await expect(client.complete({ system: 's', user: 'u', maxTokens: 10 })).rejects.toThrow('Limite d’appels');
    expect(f.calls).toHaveLength(1);
  });

  it('le plafond journalier glisse sur 24 heures : il se libère au bout d’une journée', async () => {
    let t = 0;
    const f = fakeFetch([anthropicOk('a'), anthropicOk('b')]);
    const client = createAiClient({
      config: config({ providers: [anthropic({ maxCallsPerDay: 1 })] }),
      fetch: f.fetch,
      sleep: noSleep,
      now: () => t,
    });
    await client.complete({ system: 's', user: 'u', maxTokens: 10 });
    t = 60 * 60 * 1000;
    await expect(client.complete({ system: 's', user: 'u', maxTokens: 10 })).rejects.toThrow('Limite d’appels');
    t = 24 * 60 * 60 * 1000 + 1;
    await expect(client.complete({ system: 's', user: 'u', maxTokens: 10 })).resolves.toBe('b');
  });

  it('la limite horaire globale s’applique à tous les fournisseurs à la fois', async () => {
    const f = fakeFetch([anthropicOk('a')]);
    const client = createAiClient({
      config: config({ providers: [anthropic(), openai()], maxCallsPerHour: 1 }),
      fetch: f.fetch,
      sleep: noSleep,
    });
    await client.complete({ system: 's', user: 'u', maxTokens: 10 });
    await expect(client.complete({ system: 's', user: 'u', maxTokens: 10 })).rejects.toThrow('Limite d’appels');
    expect(f.calls).toHaveLength(1);
  });

  it('une annulation n’essaie pas le fournisseur suivant', async () => {
    const calls: string[] = [];
    const client = createAiClient({
      config: config({ providers: [anthropic(), openai()], timeoutMs: 5000 }),
      fetch: ((url: string, init: RequestInit) => {
        calls.push(url);
        return hang(url, init);
      }) as typeof fetch,
      sleep: noSleep,
    });
    const controller = new AbortController();
    const pending = client.complete({ system: 's', user: 'u', maxTokens: 10, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('Génération annulée.');
    expect(calls).toHaveLength(1);
  });

  it('le journal signale le basculement, sans jamais écrire la clé', async () => {
    const warnings: Record<string, unknown>[] = [];
    const f = fakeFetch([() => json(400, {}), openaiOk('ok')]);
    const client = createAiClient({
      config: config({ providers: [anthropic(), openai()] }),
      fetch: f.fetch,
      sleep: noSleep,
      logger: { warn: (fields) => void warnings.push(fields) },
    });
    await client.complete({ system: 's', user: 'u', maxTokens: 10 });
    expect(warnings).toContainEqual(
      expect.objectContaining({ event: 'ai.failover', provider: 'anthropic', status: 400 }),
    );
    expect(JSON.stringify(warnings)).not.toContain(KEY);
  });
});

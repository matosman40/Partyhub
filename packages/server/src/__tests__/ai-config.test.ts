import { describe, expect, it } from 'vitest';
import { aiFromEnv } from '../config.js';

describe('configuration de l’IA', () => {
  it('sans clé ni AI_PROVIDER, l’IA est désactivée ; none et off la coupent explicitement', () => {
    expect(aiFromEnv({})).toBeUndefined();
    expect(aiFromEnv({ AI_PROVIDER: 'none', GROQ_API_KEY: 'g' })).toBeUndefined();
    expect(aiFromEnv({ AI_PROVIDER: 'off', ANTHROPIC_API_KEY: 'a' })).toBeUndefined();
  });

  it('sans AI_PROVIDER, le premier fournisseur dont la clé est présente est utilisé, Anthropic d’abord', () => {
    const both = aiFromEnv({ OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' })!;
    expect(both.providers.map((p) => p.id)).toEqual(['anthropic']);
    expect(aiFromEnv({ OPENAI_API_KEY: 'o' })!.providers[0]).toMatchObject({ id: 'openai', model: 'gpt-4o-mini' });
  });

  it('une liste dans AI_PROVIDER définit l’ordre de préférence', () => {
    const ai = aiFromEnv({
      AI_PROVIDER: 'groq, anthropic',
      GROQ_API_KEY: 'g',
      AI_GROQ_MODEL: 'modele-gratuit',
      ANTHROPIC_API_KEY: 'a',
    })!;
    expect(ai.providers.map((p) => [p.id, p.free])).toEqual([
      ['groq', true],
      ['anthropic', false],
    ]);
  });

  it('un fournisseur gratuit exige son modèle, faute de modèle par défaut', () => {
    expect(() => aiFromEnv({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'g' })).toThrow('AI_GROQ_MODEL est obligatoire');
  });

  it('une clé absente pour un fournisseur demandé fait échouer le démarrage', () => {
    expect(() => aiFromEnv({ AI_PROVIDER: 'mistral', AI_MISTRAL_MODEL: 'm' })).toThrow('MISTRAL_API_KEY est absente');
  });

  it('les adresses des fournisseurs connus sont celles de leur documentation', () => {
    const ai = aiFromEnv({
      AI_PROVIDER: 'groq,openrouter,mistral,gemini',
      GROQ_API_KEY: 'g',
      AI_GROQ_MODEL: 'm1',
      OPENROUTER_API_KEY: 'o',
      AI_OPENROUTER_MODEL: 'm2',
      MISTRAL_API_KEY: 'x',
      AI_MISTRAL_MODEL: 'm3',
      GEMINI_API_KEY: 'y',
      AI_GEMINI_MODEL: 'm4',
    })!;
    expect(ai.providers.map((p) => p.endpoint)).toEqual([
      'https://api.groq.com/openai/v1/chat/completions',
      'https://openrouter.ai/api/v1/chat/completions',
      'https://api.mistral.ai/v1/chat/completions',
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    ]);
  });

  it('le mode JSON et le paramètre de longueur suivent le fournisseur', () => {
    const ai = aiFromEnv({
      AI_PROVIDER: 'openai,mistral',
      OPENAI_API_KEY: 'o',
      MISTRAL_API_KEY: 'm',
      AI_MISTRAL_MODEL: 'mistral-x',
    })!;
    expect(ai.providers[0]).toMatchObject({ jsonMode: true, maxTokensField: 'max_completion_tokens' });
    expect(ai.providers[1]).toMatchObject({ jsonMode: true, maxTokensField: 'max_tokens' });
  });

  it('une racine personnalisée remplace l’adresse par défaut, sans slash final', () => {
    const ai = aiFromEnv({ ANTHROPIC_API_KEY: 'a', AI_ANTHROPIC_BASE_URL: 'http://127.0.0.1:9999/' })!;
    expect(ai.providers[0]!.endpoint).toBe('http://127.0.0.1:9999/v1/messages');
  });

  it('un fournisseur personnalisé exige son adresse, sa clé et son modèle', () => {
    expect(() => aiFromEnv({ AI_PROVIDER: 'custom', AI_CUSTOM_API_KEY: 'k', AI_CUSTOM_MODEL: 'm' })).toThrow(
      'AI_CUSTOM_BASE_URL est obligatoire',
    );
    expect(() =>
      aiFromEnv({ AI_PROVIDER: 'custom', AI_CUSTOM_BASE_URL: 'https://x.example', AI_CUSTOM_MODEL: 'm' }),
    ).toThrow('AI_CUSTOM_API_KEY est absente');
    expect(() =>
      aiFromEnv({ AI_PROVIDER: 'custom', AI_CUSTOM_BASE_URL: 'https://x.example', AI_CUSTOM_API_KEY: 'k' }),
    ).toThrow('AI_CUSTOM_MODEL est obligatoire');
    const ai = aiFromEnv({
      AI_PROVIDER: 'custom',
      AI_CUSTOM_BASE_URL: 'https://x.example',
      AI_CUSTOM_API_KEY: 'k',
      AI_CUSTOM_MODEL: 'm',
    })!;
    expect(ai.providers[0]).toMatchObject({
      id: 'custom',
      endpoint: 'https://x.example/v1/chat/completions',
      model: 'm',
    });
  });

  it('un fournisseur personnalisé n’est jamais détecté seul : il doit être demandé', () => {
    expect(
      aiFromEnv({ AI_CUSTOM_API_KEY: 'k', AI_CUSTOM_BASE_URL: 'https://x.example', AI_CUSTOM_MODEL: 'm' }),
    ).toBeUndefined();
  });

  it('les plafonds journaliers sont facultatifs et bornés', () => {
    const capped = aiFromEnv({
      AI_PROVIDER: 'groq',
      GROQ_API_KEY: 'g',
      AI_GROQ_MODEL: 'm',
      AI_GROQ_MAX_CALLS_PER_DAY: '900',
    })!;
    expect(capped.providers[0]!.maxCallsPerDay).toBe(900);
    const free = aiFromEnv({
      AI_PROVIDER: 'groq',
      GROQ_API_KEY: 'g',
      AI_GROQ_MODEL: 'm',
      AI_GROQ_MAX_CALLS_PER_DAY: '',
    })!;
    expect(free.providers[0]!.maxCallsPerDay).toBeUndefined();
    expect(() =>
      aiFromEnv({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'g', AI_GROQ_MODEL: 'm', AI_GROQ_MAX_CALLS_PER_DAY: '0' }),
    ).toThrow('AI_GROQ_MAX_CALLS_PER_DAY invalide');
  });

  it('refuse un fournisseur inconnu, un doublon, et une adresse non http', () => {
    expect(() => aiFromEnv({ AI_PROVIDER: 'inconnu' })).toThrow('AI_PROVIDER invalide');
    expect(() => aiFromEnv({ AI_PROVIDER: 'anthropic,anthropic', ANTHROPIC_API_KEY: 'a' })).toThrow('deux fois');
    expect(() => aiFromEnv({ ANTHROPIC_API_KEY: 'a', AI_ANTHROPIC_BASE_URL: 'ftp://x' })).toThrow(
      'AI_ANTHROPIC_BASE_URL invalide',
    );
  });

  it('les délais et plafonds globaux gardent leurs valeurs et leurs bornes', () => {
    const ai = aiFromEnv({ ANTHROPIC_API_KEY: 'a', AI_TIMEOUT_MS: '45000', AI_MAX_CALLS_PER_HOUR: '50' })!;
    expect(ai).toMatchObject({ timeoutMs: 45000, maxCallsPerHour: 50 });
    expect(() => aiFromEnv({ ANTHROPIC_API_KEY: 'a', AI_TIMEOUT_MS: '100' })).toThrow('AI_TIMEOUT_MS invalide');
  });
});

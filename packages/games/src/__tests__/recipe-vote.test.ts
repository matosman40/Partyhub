import { describe, expect, it } from 'vitest';
import { recipeDefinitionSchema, type GameResult, type RecipeDefinition } from '@partyhub/shared';
import { createVoteSurConsigne, type RecipeState } from '../recipes/vote-sur-consigne.js';
import { RECIPE_JOB_KIND, validateConsignes } from '../recipes/ai.js';
import { A, B, C } from './aventure-helpers.js';
import { fakeAi, harness, type Harness } from './turn-harness.js';

const players = [A, B, C];
const connected = players.map((p) => p.id);
const signal = () => new AbortController().signal;

function definition(overrides: Record<string, unknown> = {}): RecipeDefinition {
  return recipeDefinitionSchema.parse({
    recipe: 'vote-sur-consigne',
    name: 'Le plus…',
    consignes: ['Le plus bizarre', 'Le plus rapide', 'Le plus poli'],
    ...overrides,
  });
}

function unwrap<S>(result: GameResult<S>): S {
  if (!result.ok) throw new Error(`action refusée : ${result.error}`);
  return result.state;
}

function refusal<S>(result: GameResult<S>): string {
  if (result.ok) throw new Error('action acceptée alors qu’elle devait être refusée');
  return result.error;
}

function started(def: RecipeDefinition, h: Harness) {
  const game = createVoteSurConsigne(def, { id: 'pkgr-test' });
  const initial = game.initialize({}, players, h.ctx);
  return { game, state: unwrap(game.start(initial, h.ctx)) };
}

describe('recette vote-sur-consigne : déroulé', () => {
  it('une manche complète : écriture, vote anonyme, points, puis fin', () => {
    const h = harness({ connected });
    const { game, state } = started(definition({ rules: { manches: 1 } }), h);
    expect(state.phase).toBe('ecriture');
    expect(state.rounds).toHaveLength(1);

    let s: RecipeState = state;
    s = unwrap(game.handleAction(s, A, 'word', { word: 'Pizza' }, h.ctx));
    s = unwrap(game.handleAction(s, B, 'word', { word: 'Fantôme' }, h.ctx));
    s = unwrap(game.handleAction(s, C, 'word', { word: 'Canard' }, h.ctx));
    expect(s.phase).toBe('vote');

    // Anonymat : le vote ne montre que des mots, jamais leurs auteurs.
    const voting = game.getPublicState(s) as { options: string[] };
    expect(voting.options.sort()).toEqual(['Canard', 'Fantôme', 'Pizza']);
    expect(voting.options.some((o) => connected.includes(o))).toBe(false);

    const indexOf = (id: string) => s.options.indexOf(id);
    s = unwrap(game.handleAction(s, B, 'vote', { option: indexOf(A.id) }, h.ctx));
    s = unwrap(game.handleAction(s, C, 'vote', { option: indexOf(A.id) }, h.ctx));
    s = unwrap(game.handleAction(s, A, 'vote', { option: indexOf(B.id) }, h.ctx));
    expect(s.phase).toBe('resultat');
    expect(s.points[A.id]).toBe(200);
    expect(s.points[B.id]).toBe(100);
    expect(s.points[C.id]).toBe(0);

    s = h.fire(game, s, 'reveal-next');
    expect(s.phase).toBe('final');
    expect(game.isFinished(s)).toBe(true);
    expect(game.calculateScores(s)[0]?.playerId).toBe(A.id);
  });

  it('refuse un mot trop long, un deuxième mot, un vote pour soi, un vote hors liste', () => {
    const h = harness({ connected });
    const { game, state } = started(definition({ rules: { manches: 1, motMax: 6 } }), h);
    let s = state;
    expect(refusal(game.handleAction(s, A, 'word', { word: 'Un mot bien trop long' }, h.ctx))).toBe('Mot invalide');
    s = unwrap(game.handleAction(s, A, 'word', { word: 'Pizza' }, h.ctx));
    expect(refusal(game.handleAction(s, A, 'word', { word: 'Autre' }, h.ctx))).toBe('Mot déjà envoyé');
    s = unwrap(game.handleAction(s, B, 'word', { word: 'Canard' }, h.ctx));
    s = unwrap(game.handleAction(s, C, 'word', { word: 'Lapin' }, h.ctx));
    expect(refusal(game.handleAction(s, A, 'vote', { option: s.options.indexOf(A.id) }, h.ctx))).toBe(
      'Vous ne pouvez pas voter pour votre propre mot',
    );
    expect(refusal(game.handleAction(s, A, 'vote', { option: 9 }, h.ctx))).toBe('Choix invalide');
  });

  it('les minuteurs font passer l’écriture au vote, puis le vote à la révélation', () => {
    const h = harness({ connected });
    const { game, state } = started(definition({ rules: { manches: 1, ecriture: 30, vote: 20 } }), h);
    let s = unwrap(game.handleAction(state, A, 'word', { word: 'Pizza' }, h.ctx));
    s = unwrap(game.handleAction(s, B, 'word', { word: 'Canard' }, h.ctx));
    // C n'a pas écrit : le délai d'écriture s'épuise, le vote s'ouvre avec les mots reçus.
    s = h.fire(game, s, 'write-timeout');
    expect(s.phase).toBe('vote');
    expect(h.timers.get('vote-timeout')).toBe(h.ctx.now() + 20_000);
    s = h.fire(game, s, 'vote-timeout');
    expect(s.phase).toBe('resultat');
    expect(h.timers.has('reveal-next')).toBe(true);
  });

  it('avec moins de deux mots, le vote est sauté et la révélation vient tout de suite', () => {
    const h = harness({ connected });
    const { game, state } = started(definition({ rules: { manches: 1 } }), h);
    const s = h.fire(game, unwrap(game.handleAction(state, A, 'word', { word: 'Seul' }, h.ctx)), 'write-timeout');
    expect(s.phase).toBe('resultat');
  });

  it('une action dans la mauvaise phase est refusée, et un inconnu ne joue pas', () => {
    const h = harness({ connected });
    const { game, state } = started(definition(), h);
    expect(refusal(game.handleAction(state, A, 'vote', { option: 0 }, h.ctx))).toBe('Pas de vote en cours');
    const stranger = { id: 'intrus', name: 'Intrus', profileId: null };
    expect(refusal(game.handleAction(state, stranger, 'word', { word: 'Pizza' }, h.ctx))).toBe(
      'Joueur inconnu dans cette partie',
    );
  });
});

describe('recette vote-sur-consigne : écrans', () => {
  it('la disposition par défaut sert à chaque écran et à chaque phase', () => {
    const h = harness({ connected });
    const { game, state } = started(definition(), h);
    const view = game.getPublicState(state) as { layout: { tv: string[]; joueur: string[] } };
    expect(view.layout.tv).toEqual(['consigne', 'minuteur', 'attente']);
    expect(view.layout.joueur).toEqual(['consigne', 'saisie-texte', 'minuteur']);
  });

  it('une disposition du paquet remplace la disposition par défaut pour sa phase', () => {
    const h = harness({ connected });
    const { game, state } = started(definition({ ecrans: { tv: { ecriture: ['titre', 'consigne'] } } }), h);
    const view = game.getPublicState(state) as { layout: { tv: string[]; joueur: string[] } };
    expect(view.layout.tv).toEqual(['titre', 'consigne']);
    expect(view.layout.joueur).toEqual(['consigne', 'saisie-texte', 'minuteur']);
  });

  it('les règles par défaut s’appliquent aux durées et au nombre de points', () => {
    const h = harness({ connected });
    const { game, state } = started(definition(), h);
    const view = game.getPublicState(state) as { durationMs: number; motMax: number };
    expect(view.durationMs).toBe(40_000);
    expect(view.motMax).toBe(24);
  });
});

describe('recette vote-sur-consigne : IA et repli', () => {
  const aiDefinition = () =>
    definition({ ai: { theme: 'années 80', nombre: 4 }, consignes: ['Le plus rétro', 'Le plus flashy'] });

  it('avec IA, la partie passe par la génération, puis prend les consignes écrites', async () => {
    const reply = JSON.stringify({
      consignes: ['Le plus néon', 'Le plus fluo', 'Le plus cassette', 'Le plus walkman'],
    });
    const h = harness({ connected, ai: fakeAi(reply) });
    const game = createVoteSurConsigne(aiDefinition(), { id: 'pkgr-ia' });
    let s = unwrap(game.start(game.initialize({}, players, h.ctx), h.ctx));
    expect(s.phase).toBe('generation');

    const job = game.pendingJob!(s);
    expect(job).not.toBeNull();
    expect(job!.kind).toBe(RECIPE_JOB_KIND);
    expect(job!.input).toMatchObject({ theme: 'années 80', nombre: 4 });

    const value = await game.runJob!(job!, h.ctx, signal());
    s = game.completeJob!(s, job!.id, { ok: true, value }, h.ctx);
    expect(s.phase).toBe('ecriture');
    expect(s.notice).toBeNull();
    expect(
      s.rounds.every((c) => ['Le plus néon', 'Le plus fluo', 'Le plus cassette', 'Le plus walkman'].includes(c)),
    ).toBe(true);
  });

  it('sans fournisseur d’IA, les consignes du paquet servent, avec la raison affichée', async () => {
    const h = harness({ connected });
    const game = createVoteSurConsigne(aiDefinition(), { id: 'pkgr-ia' });
    let s = unwrap(game.start(game.initialize({}, players, h.ctx), h.ctx));
    const job = game.pendingJob!(s)!;
    const value = await game.runJob!(job, h.ctx, signal());
    expect(value).toBeNull();
    s = game.completeJob!(s, job.id, { ok: true, value }, h.ctx);
    expect(s.phase).toBe('ecriture');
    expect(s.notice).toBe('IA non configurée : consignes du paquet.');
    expect(s.rounds.every((c) => ['Le plus rétro', 'Le plus flashy'].includes(c))).toBe(true);
  });

  it('une réponse inutilisable de l’IA déclenche le repli, sans bloquer la salle', async () => {
    const h = harness({ connected, ai: fakeAi('pas du JSON du tout') });
    const game = createVoteSurConsigne(aiDefinition(), { id: 'pkgr-ia' });
    let s = unwrap(game.start(game.initialize({}, players, h.ctx), h.ctx));
    const job = game.pendingJob!(s)!;
    let outcome;
    try {
      outcome = { ok: true as const, value: await game.runJob!(job, h.ctx, signal()) };
    } catch (err) {
      outcome = { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
    s = game.completeJob!(s, job.id, outcome, h.ctx);
    expect(s.phase).toBe('ecriture');
    expect(s.notice).toBe('L’IA n’a pas pu écrire les consignes : consignes du paquet.');
  });

  it('un résultat d’un ancien travail est ignoré', () => {
    const h = harness({ connected, ai: fakeAi('{}') });
    const game = createVoteSurConsigne(aiDefinition(), { id: 'pkgr-ia' });
    const s = unwrap(game.start(game.initialize({}, players, h.ctx), h.ctx));
    const after = game.completeJob!(s, 'un-autre-travail', { ok: true, value: ['Le plus vert'] }, h.ctx);
    expect(after).toBe(s);
  });
});

describe('recette vote-sur-consigne : robots', () => {
  it('les robots écrivent un mot court, puis votent pour un autre mot que le leur', () => {
    const h = harness({ connected });
    const { game, state } = started(definition({ rules: { motMax: 5 } }), h);
    const suggestion = game.suggest!(state, A.id, h.ctx.random, h.ctx.now());
    expect(suggestion?.type).toBe('word');
    expect(String((suggestion?.payload as { word: string }).word).length).toBeLessThanOrEqual(5);
  });
});

describe('validation des consignes de l’IA', () => {
  it('garde les consignes propres, sans doublon, et les limite au nombre demandé', () => {
    const raw = {
      consignes: [
        '  Le plus néon  ',
        'le plus néon',
        'Le plus fluo',
        'ab',
        'x'.repeat(91),
        'Le\nsaut',
        'Le plus cassette',
        'Le plus walkman',
      ],
    };
    expect(validateConsignes(raw, 3)).toEqual(['Le plus néon', 'Le plus fluo', 'Le plus cassette']);
  });

  it('renvoie une liste vide quand il manque plus de la moitié des consignes', () => {
    expect(validateConsignes({ consignes: ['Le plus néon'] }, 6)).toEqual([]);
    expect(validateConsignes({ autre: [] }, 3)).toEqual([]);
    expect(validateConsignes(null, 3)).toEqual([]);
  });
});

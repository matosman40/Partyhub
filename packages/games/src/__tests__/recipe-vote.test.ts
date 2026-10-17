import { describe, expect, it } from 'vitest';
import { recipeDefinitionSchema, type GameResult, type RecipeDefinition } from '@partyhub/shared';
import { createVoteSurConsigne, type RecipeState } from '../recipes/vote-sur-consigne.js';
import { RECIPE_JOB_KIND, validateConsignes } from '../recipes/ai.js';
import { isAcceptableConsigne } from '../recipes/moderation.js';
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

describe('recette vote-sur-consigne : plafond d’IA et contenu des consignes', () => {
  const aiDefinition = () =>
    definition({ ai: { theme: 'années 80', nombre: 4 }, consignes: ['Le plus rétro', 'Le plus flashy'] });

  it('au-delà de dix générations par heure, la partie prend les consignes du paquet, avec un message', () => {
    const h = harness({ connected, ai: fakeAi('{}') });
    const game = createVoteSurConsigne(aiDefinition(), { id: 'pkgr-ia' });
    for (let i = 0; i < 10; i++) {
      expect(unwrap(game.start(game.initialize({}, players, h.ctx), h.ctx)).phase).toBe('generation');
    }
    const limited = unwrap(game.start(game.initialize({}, players, h.ctx), h.ctx));
    expect(limited.phase).toBe('ecriture');
    expect(limited.notice).toBe('Limite d’IA atteinte pour cette recette : consignes du paquet.');
    h.advance(60 * 60 * 1000);
    expect(unwrap(game.start(game.initialize({}, players, h.ctx), h.ctx)).phase).toBe('generation');
  });

  it('sans fournisseur d’IA, les démarrages ne consomment pas le plafond', () => {
    const h = harness({ connected });
    const game = createVoteSurConsigne(aiDefinition(), { id: 'pkgr-ia' });
    for (let i = 0; i < 12; i++) {
      expect(unwrap(game.start(game.initialize({}, players, h.ctx), h.ctx)).phase).toBe('generation');
    }
  });

  it('écarte une consigne refusée, avant de la montrer aux joueurs', () => {
    const raw = {
      consignes: [
        'Le plus néon',
        'Le plus pute',
        'Va sur https://exemple.fr',
        'Le plus cassette',
        'Le plus walkman',
        'Le plus rétro',
      ],
    };
    expect(validateConsignes(raw, 4)).toEqual(['Le plus néon', 'Le plus cassette', 'Le plus walkman', 'Le plus rétro']);
  });

  it('refuse les termes listés, sans tenir compte des accents ni de la casse', () => {
    expect(isAcceptableConsigne('Le plus NÉGRE')).toBe(false);
    expect(isAcceptableConsigne('Le plus de l’enculé')).toBe(false);
    expect(isAcceptableConsigne('Le plus pénible à la plage')).toBe(true);
    expect(isAcceptableConsigne('Le plus susceptible d’oublier son téléphone en vacances')).toBe(true);
  });

  it('refuse adresses, e-mails et balisage', () => {
    expect(isAcceptableConsigne('Le plus visité sur monsite.fr')).toBe(false);
    expect(isAcceptableConsigne('Écrivez à quelqu’un@mail')).toBe(false);
    expect(isAcceptableConsigne('Le plus <b>gras</b>')).toBe(false);
  });
});

describe('recette vote-sur-consigne : départ d’un joueur en cours de partie', () => {
  it('si le dernier joueur attendu part pendant l’écriture, le vote s’ouvre tout de suite', () => {
    const h = harness({ connected: [...connected] });
    const { game, state } = started(definition(), h);
    let s = unwrap(game.handleAction(state, A, 'word', { word: 'Chat' }, h.ctx));
    s = unwrap(game.handleAction(s, B, 'word', { word: 'Chien' }, h.ctx));
    expect(s.phase).toBe('ecriture');
    h.connected.splice(h.connected.indexOf(C.id), 1);
    s = game.onPlayerLeave(s, C, h.ctx);
    expect(s.phase).toBe('vote');
    expect(h.timers.has('write-timeout')).toBe(false);
    expect(h.timers.has('vote-timeout')).toBe(true);
  });

  it('si le dernier joueur attendu part pendant le vote, la révélation vient tout de suite', () => {
    const h = harness({ connected: [...connected] });
    const { game, state } = started(definition(), h);
    let s = unwrap(game.handleAction(state, A, 'word', { word: 'Chat' }, h.ctx));
    s = unwrap(game.handleAction(s, B, 'word', { word: 'Chien' }, h.ctx));
    // C n'a pas écrit : c'est le délai d'écriture qui ouvre le vote.
    s = h.fire(game, s, 'write-timeout');
    s = unwrap(game.handleAction(s, A, 'vote', { option: s.options.indexOf(B.id) }, h.ctx));
    s = unwrap(game.handleAction(s, B, 'vote', { option: s.options.indexOf(A.id) }, h.ctx));
    expect(s.phase).toBe('vote');
    h.connected.splice(h.connected.indexOf(C.id), 1);
    s = game.onPlayerLeave(s, C, h.ctx);
    expect(s.phase).toBe('resultat');
  });

  it('le joueur parti n’est plus attendu sur l’écran principal, ni compté sur les téléphones', () => {
    const h = harness({ connected: [...connected] });
    const { game, state } = started(definition(), h);
    h.connected.splice(h.connected.indexOf(C.id), 1);
    const s = game.onPlayerLeave(state, C, h.ctx);
    expect(game.getHostState(s).pending).toEqual([A.name, B.name]);
    expect(game.getPublicState(s).playerCount).toBe(2);
  });

  it('ses points restent au classement, mais il ne peut plus écrire ni voter', () => {
    const h = harness({ connected: [...connected] });
    const { game, state } = started(definition(), h);
    h.connected.splice(h.connected.indexOf(C.id), 1);
    const s = game.onPlayerLeave(state, C, h.ctx);
    expect(game.getPublicState(s).ranking.map((e) => e.playerId)).toContain(C.id);
    expect(refusal(game.handleAction(s, C, 'word', { word: 'Tard' }, h.ctx))).toBe('Joueur inconnu dans cette partie');
  });
});

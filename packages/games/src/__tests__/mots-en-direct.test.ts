import { describe, expect, it } from 'vitest';
import { crosswordEngine, generateCrossword, motsSupplementaires } from '../solo/crossword.js';
import { motsDepuisLignes, versIndice, versMot } from '../solo/mots-en-direct.js';
import { motsCroises as crossword } from '../solo/games.js';
import { A, B, must } from './aventure-helpers.js';
import { harness } from './turn-harness.js';

describe('mots croisés en direct : mots et indices', () => {
  it('convertit un libellé français en mot de grille, et refuse noms propres et composés', () => {
    expect(versMot('éléphant')).toBe('ELEPHANT');
    expect(versMot('Duolingo')).toBeNull();
    expect(versMot('chat-tigre')).toBeNull();
    expect(versMot('ail')).toBeNull();
    expect(versMot('pomme 2')).toBeNull();
  });

  it('garde un indice court, sans parenthèse, sans chiffre, qui ne contient pas le mot', () => {
    expect(versIndice('fruit', 'POIRE')).toBe('Fruit');
    expect(versIndice('Logiciel malveillant', 'VIRUS')).toBeNull();
    expect(versIndice('espèce (ou variété) de plante', 'ORCHIDEE')).toBeNull();
    expect(versIndice('en 1999 déjà', 'MOT')).toBeNull();
    expect(versIndice('un chat de rue', 'CHAT')).toBeNull();
  });

  it('dédoublonne les mots d’une réponse Wikidata', () => {
    const mots = motsDepuisLignes([
      { label: { value: 'poire' }, desc: { value: 'fruit du poirier' } },
      { label: { value: 'poire' }, desc: { value: 'autre description' } },
      { label: { value: 'Duolingo' }, desc: { value: 'plate-forme en ligne' } },
    ]);
    expect(mots).toEqual([{ word: 'POIRE', clue: 'Fruit du poirier' }]);
  });

  it('les mots supplémentaires invalides sont écartés ; la grille reste reproductible', () => {
    const extra = motsSupplementaires([
      { word: 'ORANGE', clue: 'Fruit orangé' },
      { word: 'ORANGE', clue: 'doublon' },
      { word: 'x', clue: 'trop court' },
    ]);
    expect(extra).toHaveLength(1);
    const a = generateCrossword(42, extra);
    const b = generateCrossword(42, extra);
    expect(b.solution).toEqual(a.solution);
  });

  it('le moteur des mots croisés accepte les mots tirés en direct dans ses réglages', () => {
    const board = crosswordEngine.create(7, { mots: [{ word: 'MANGUE', clue: 'Fruit tropical' }] });
    expect(board.grid.solution.filter((c) => c !== null).length).toBeGreaterThan(0);
  });
});

describe('mots croisés en direct : déroulé', () => {
  it('passe par la préparation, puis lance les grilles sur les mots reçus', () => {
    const h = harness({ connected: [A.id, B.id] });
    const s0 = crossword.initialize({ timeLimitSec: 0 }, [A, B], h.ctx);
    const s = must(crossword.start(s0, h.ctx));
    expect(s.phase).toBe('preparation');
    expect(crossword.pendingJob?.(s)).toMatchObject({ id: 'mots-en-direct', kind: 'solo-mots' });
    const jouee = crossword.completeJob!(
      s,
      'mots-en-direct',
      { ok: true, value: [{ word: 'MANGUE', clue: 'Fruit tropical' }] },
      h.ctx,
    );
    expect(jouee.phase).toBe('play');
    expect(Object.keys(jouee.boards)).toEqual([A.id, B.id]);
  });

  it('sans réseau, la grille part de la banque locale', () => {
    const h = harness({ connected: [A.id] });
    const s0 = crossword.initialize({ timeLimitSec: 0 }, [A], h.ctx);
    const s = must(crossword.start(s0, h.ctx));
    const sans = crossword.completeJob!(s, 'mots-en-direct', { ok: false, error: 'délai' }, h.ctx);
    expect(sans.phase).toBe('play');
  });
});

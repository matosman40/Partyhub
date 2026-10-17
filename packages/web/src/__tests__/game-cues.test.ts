import { describe, expect, it } from 'vitest';
import { allowCue, cueFor, phaseOf } from '../tv/gameCues.js';

/** Bruitages de l'écran principal : déduits du statut de la salle et de l'étape du jeu, sans réglage par jeu. */

describe('Bruitages de partie', () => {
  it('ne joue rien au premier état reçu (reprise d’écran en pleine partie)', () => {
    expect(cueFor(null, { status: 'in_game', phase: 'play' })).toBeNull();
  });

  it('annonce le début de la partie, puis chaque étape, puis la fin', () => {
    const lobby = { status: 'waiting' as const, phase: null };
    const started = { status: 'in_game' as const, phase: 'ready' };
    expect(cueFor(lobby, started)).toBe('start');
    expect(cueFor(started, { status: 'in_game', phase: 'play' })).toBe('click');
    expect(cueFor({ status: 'in_game', phase: 'play' }, { status: 'ended', phase: 'final' })).toBe('final');
  });

  it('fait sonner le bilan avec un bruit de jetons, et l’étape finale avec la fanfare', () => {
    const play = { status: 'in_game' as const, phase: 'play' };
    expect(cueFor(play, { status: 'in_game', phase: 'reveal' })).toBe('chip');
    expect(cueFor(play, { status: 'in_game', phase: 'round-over' })).toBe('chip');
    expect(cueFor(play, { status: 'in_game', phase: 'final' })).toBe('final');
  });

  it('ne rejoue rien quand l’étape ne change pas', () => {
    const play = { status: 'in_game' as const, phase: 'play' };
    expect(cueFor(play, { status: 'in_game', phase: 'play' })).toBeNull();
  });

  it('reste silencieux hors partie : salon, changements de joueurs', () => {
    expect(cueFor({ status: 'waiting', phase: null }, { status: 'full', phase: null })).toBeNull();
    expect(cueFor({ status: 'waiting', phase: 'ready' }, { status: 'waiting', phase: 'play' })).toBeNull();
  });

  it('ne sonne qu’une fois la fin de partie quand le statut et l’étape arrivent ensemble', () => {
    expect(cueFor({ status: 'in_game', phase: 'play' }, { status: 'ended', phase: 'final' })).toBe('final');
    expect(cueFor({ status: 'ended', phase: 'final' }, { status: 'ended', phase: 'final' })).toBeNull();
  });
});

describe('Espacement des bruitages', () => {
  const now = 10_000;

  it('laisse passer le premier bruitage', () => {
    expect(allowCue(null, 'click', now)).toBe(true);
  });

  it('refuse deux bruitages qui se suivent de moins d’une demi-seconde', () => {
    expect(allowCue({ name: 'start', at: now - 200 }, 'click', now)).toBe(false);
    expect(allowCue({ name: 'start', at: now - 600 }, 'click', now)).toBe(true);
  });

  it('refuse le même bruitage répété dans les trois secondes (fin de partie envoyée deux fois)', () => {
    expect(allowCue({ name: 'final', at: now - 1500 }, 'final', now)).toBe(false);
    expect(allowCue({ name: 'final', at: now - 4000 }, 'final', now)).toBe(true);
  });
});

describe('Étape annoncée par l’état public', () => {
  it('lit le champ phase quand le jeu le fournit', () => {
    expect(phaseOf({ phase: 'reveal', round: 2 })).toBe('reveal');
  });

  it('renvoie null pour un état sans étape, ou absent', () => {
    expect(phaseOf({ round: 2 })).toBeNull();
    expect(phaseOf({ phase: 3 })).toBeNull();
    expect(phaseOf(null)).toBeNull();
    expect(phaseOf(undefined)).toBeNull();
  });
});

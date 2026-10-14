import { describe, expect, it } from 'vitest';
import { boardGameDefinitionSchema, type BoardCellKind } from '../board-games.js';
import { defaultAvatarFor, hashText, AVATAR_EMOJIS } from '../avatars.js';
import { isValidRoomCode, normalizeRoomCode, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../room-codes.js';

describe('Codes de salle', () => {
  it('accepte un code de la longueur et de l’alphabet attendus', () => {
    expect(ROOM_CODE_LENGTH).toBe(4);
    expect(isValidRoomCode('ABCD')).toBe(true);
    expect(isValidRoomCode('2345')).toBe(true);
  });

  it('refuse les caractères ambigus (0, O, 1, I, L) et les mauvaises longueurs', () => {
    for (const bad of ['AB0D', 'ABOD', 'AB1D', 'ABID', 'ABLD', 'ABC', 'ABCDE', '']) {
      expect(isValidRoomCode(bad), bad).toBe(false);
    }
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[01ILO]/);
  });

  it('normalise la saisie : espaces retirés, majuscules', () => {
    expect(normalizeRoomCode('  ab3d ')).toBe('AB3D');
    expect(isValidRoomCode(normalizeRoomCode(' k7m2 '))).toBe(true);
  });
});

describe('Avatars par défaut', () => {
  it('donne toujours le même avatar pour le même texte', () => {
    expect(defaultAvatarFor('Nina')).toEqual(defaultAvatarFor('Nina'));
    expect(hashText('Nina')).toBe(hashText('Nina'));
  });

  it('choisit un emoji de la liste et une teinte entre 0 et 359', () => {
    for (const seed of ['Nina', 'Léo', 'x', '', 'un pseudo très long avec des accents é ç']) {
      const avatar = defaultAvatarFor(seed);
      expect(AVATAR_EMOJIS).toContain(avatar.emoji);
      expect(avatar.hue).toBeGreaterThanOrEqual(0);
      expect(avatar.hue).toBeLessThan(360);
    }
  });

  it('sépare la plupart des pseudos courants', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => `joueur${i}`);
    const distinct = new Set(seeds.map((s) => `${defaultAvatarFor(s).emoji}-${defaultAvatarFor(s).hue}`));
    expect(distinct.size).toBeGreaterThan(20);
  });
});

/** Plateau minimal valide : départ normal, arrivée en dernier, cases à valeur quand il le faut. */
function board(overrides: Partial<{ cells: unknown[]; minPlayers: number; maxPlayers: number }> = {}) {
  const cells: { label: string; kind: BoardCellKind; value: number }[] = [
    { label: 'Départ', kind: 'normal', value: 0 },
    { label: 'Avance', kind: 'avance', value: 2 },
    { label: 'Pause', kind: 'passe', value: 0 },
    { label: 'Perte', kind: 'perte', value: 1 },
    { label: 'Gain', kind: 'gain', value: 3 },
    { label: 'Recule', kind: 'recule', value: 1 },
    { label: 'Calme', kind: 'normal', value: 0 },
    { label: 'Arrivée', kind: 'arrivee', value: 0 },
  ];
  return {
    name: 'Plateau test',
    description: 'Un plateau pour les tests.',
    icon: '🎲',
    theme: 'arcade',
    cells: overrides.cells ?? cells,
    rules: { minPlayers: overrides.minPlayers ?? 2, maxPlayers: overrides.maxPlayers ?? 4, dice: 1, turnSeconds: 0 },
    notice: { goal: 'Arriver le premier.', steps: ['Lancer le dé.'], tips: [] },
  };
}

describe('Définition de plateau', () => {
  it('accepte un plateau minimal valide', () => {
    expect(boardGameDefinitionSchema.safeParse(board()).success).toBe(true);
  });

  it('refuse un départ qui n’est pas une case normale', () => {
    const cells = board().cells.map((c, i) => (i === 0 ? { ...c, kind: 'passe' as const } : c));
    const result = boardGameDefinitionSchema.safeParse(board({ cells }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('départ');
  });

  it('refuse une arrivée qui n’est pas la dernière case', () => {
    const cells = board().cells.map((c, i) => (i === 6 ? { ...c, kind: 'arrivee' as const } : c));
    expect(boardGameDefinitionSchema.safeParse(board({ cells })).success).toBe(false);
  });

  it('exige une valeur pour les cases qui en ont besoin', () => {
    const cells = board().cells.map((c) => (c.kind === 'avance' ? { ...c, value: 0 } : c));
    const result = boardGameDefinitionSchema.safeParse(board({ cells }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('Valeur requise');
  });

  it('refuse un minimum de joueurs supérieur au maximum, et moins de 8 cases', () => {
    expect(boardGameDefinitionSchema.safeParse(board({ minPlayers: 5, maxPlayers: 3 })).success).toBe(false);
    expect(boardGameDefinitionSchema.safeParse(board({ cells: board().cells.slice(0, 5) })).success).toBe(false);
  });
});

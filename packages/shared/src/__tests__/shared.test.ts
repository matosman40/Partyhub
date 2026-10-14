import { describe, expect, it } from 'vitest';
import { boardGameDefinitionSchema, type BoardCellKind } from '../board-games.js';
import { defaultAvatarFor, hashText, AVATAR_EMOJIS } from '../avatars.js';
import {
  isValidRoomCode,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_DEFAULT_LENGTH,
  ROOM_CODE_MAX_LENGTH,
  ROOM_CODE_MIN_LENGTH,
} from '../room-codes.js';

describe('Codes de salle', () => {
  it('sont faits de chiffres, de 4 à 6, 4 par défaut', () => {
    expect(ROOM_CODE_DEFAULT_LENGTH).toBe(4);
    expect(ROOM_CODE_MIN_LENGTH).toBe(4);
    expect(ROOM_CODE_MAX_LENGTH).toBe(6);
    expect(ROOM_CODE_ALPHABET).toBe('0123456789');
    expect(isValidRoomCode('1234')).toBe(true);
    expect(isValidRoomCode('123456')).toBe(true);
    expect(isValidRoomCode('12345')).toBe(true);
  });

  it('refuse les lettres, les autres caractères et les mauvaises longueurs', () => {
    for (const bad of ['ABCD', '12a4', '12 4', '1-34', '123', '1234567', '']) {
      expect(isValidRoomCode(bad), bad).toBe(false);
    }
  });

  it('normalise la saisie : espaces retirés', () => {
    expect(normalizeRoomCode('  1234 ')).toBe('1234');
    expect(isValidRoomCode(normalizeRoomCode(' 0042 '))).toBe(true);
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

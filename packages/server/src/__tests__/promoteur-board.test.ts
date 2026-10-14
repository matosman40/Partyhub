import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, cellOf, nextSquare, stepsBetween } from '@partyhub/games';

/** Disposition du plateau du Promoteur : anneau de 24 cases sur une grille 7 × 7. */
describe('Anneau du plateau du Promoteur', () => {
  const cells = Array.from({ length: BOARD_SIZE }, (_, i) => cellOf(i));

  it('place chaque case sur un bord de la grille, sans doublon', () => {
    const keys = new Set(cells.map((c) => `${c.col},${c.row}`));
    expect(keys.size).toBe(BOARD_SIZE);
    for (const { col, row } of cells) {
      const onEdge = col === 0 || col === 6 || row === 0 || row === 6;
      expect(onEdge).toBe(true);
    }
  });

  it('enchaîne les cases côte à côte, y compris du dernier au premier (tour complet)', () => {
    for (let i = 0; i < BOARD_SIZE; i++) {
      const a = cells[i]!;
      const b = cells[nextSquare(i)]!;
      expect(Math.abs(a.col - b.col) + Math.abs(a.row - b.row)).toBe(1);
    }
  });

  it('connaît les coins du départ', () => {
    expect(cellOf(0)).toEqual({ col: 6, row: 6 });
    expect(cellOf(6)).toEqual({ col: 0, row: 6 });
    expect(cellOf(12)).toEqual({ col: 0, row: 0 });
    expect(cellOf(18)).toEqual({ col: 6, row: 0 });
  });

  it('compte les pas dans le sens du jeu, en passant par le départ', () => {
    expect(stepsBetween(0, 0)).toBe(0);
    expect(stepsBetween(5, 9)).toBe(4);
    expect(stepsBetween(22, 3)).toBe(5);
    expect(stepsBetween(0, 23)).toBe(23);
    expect(nextSquare(23)).toBe(0);
  });
});

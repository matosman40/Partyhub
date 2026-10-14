import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveGame, allGames } from '../games-registry.js';
import { BoardGameService, BOARD_GAME_PREFIX } from '../boards/service.js';
import { Store, LATEST_SCHEMA_VERSION } from '../db/store.js';
import { boardGameDefinitionSchema, type BoardCell } from '@partyhub/shared';

const N = (label = ''): BoardCell => ({ label, kind: 'normal', value: 0 });
const A = (): BoardCell => ({ label: 'Arrivée', kind: 'arrivee', value: 0 });

function plateau(name = 'Parcours du soir') {
  return {
    name,
    description: 'Un parcours jusqu’à l’arrivée.',
    icon: '🎲',
    theme: 'arcade',
    cells: [N('Départ'), { label: 'Bonus', kind: 'gain', value: 2 }, ...Array.from({ length: 5 }, () => N()), A()],
    rules: { minPlayers: 2, maxPlayers: 4, dice: 1, turnSeconds: 20 },
    notice: { goal: 'Arriver le premier.', steps: ['Lancez les dés.'], tips: [] },
  };
}

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ph-plateaux-'));
  store = new Store(path.join(dir, 'partyhub.db'));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('schéma de base 3 (plateaux)', () => {
  it('crée la table des plateaux à la version courante', () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(3);
    expect(store.listBoardGames()).toEqual([]);
  });
});

describe('jeux de plateau personnalisés', () => {
  it('enregistre, relit et rend jouable un plateau avec un préfixe board-', () => {
    const service = new BoardGameService(store);
    const result = service.save(null, plateau());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.id.startsWith(BOARD_GAME_PREFIX)).toBe(true);

    const records = service.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.definition.name).toBe('Parcours du soir');

    const module = resolveGame(result.id);
    expect(module?.manifest).toMatchObject({ id: result.id, category: 'plateau', name: 'Parcours du soir' });
    expect(allGames().some((g) => g.manifest.id === result.id)).toBe(true);
  });

  it('refuse un plateau invalide avec le message de la règle violée', () => {
    const service = new BoardGameService(store);
    // Neuf cases, aucune arrivée : seule la règle de l’arrivée doit échouer.
    const bad = { ...plateau(), cells: [N('Départ'), ...Array.from({ length: 8 }, () => N())] };
    const result = service.save(null, bad);
    expect(result).toEqual({ ok: false, error: 'La dernière case doit être la case d’arrivée.' });
    expect(service.list()).toEqual([]);
  });

  it('modifie un plateau existant sans en créer un autre', () => {
    const service = new BoardGameService(store);
    const created = service.save(null, plateau());
    if (!created.ok) throw new Error(created.error);
    const updated = service.save(created.id, plateau('Nouveau nom'));
    expect(updated).toEqual({ ok: true, id: created.id });
    expect(service.list().map((r) => r.definition.name)).toEqual(['Nouveau nom']);
  });

  it('refuse la modification d’un plateau inconnu', () => {
    const service = new BoardGameService(store);
    expect(service.save('board-inconnu', plateau())).toEqual({ ok: false, error: 'Jeu inconnu.' });
  });

  it('copie un plateau sous un nouveau nom', () => {
    const service = new BoardGameService(store);
    const created = service.save(null, plateau());
    if (!created.ok) throw new Error(created.error);
    const copy = service.duplicate(created.id);
    if (!copy.ok) throw new Error(copy.error);
    expect(copy.id).not.toBe(created.id);
    expect(service.list().map((r) => r.definition.name).sort()).toEqual(
      ['Parcours du soir', 'Parcours du soir (copie)'].sort(),
    );
  });

  it('supprime un plateau et le retire du registre', () => {
    const service = new BoardGameService(store);
    const created = service.save(null, plateau());
    if (!created.ok) throw new Error(created.error);
    expect(service.remove(created.id)).toBe(true);
    expect(resolveGame(created.id)).toBeUndefined();
    expect(service.remove(created.id)).toBe(false);
  });

  it('retrouve les plateaux après un redémarrage du service', () => {
    const first = new BoardGameService(store);
    const created = first.save(null, plateau());
    if (!created.ok) throw new Error(created.error);
    const restarted = new BoardGameService(store);
    expect(restarted.list()).toHaveLength(1);
    expect(resolveGame(created.id)).toBeDefined();
  });

  it('ignore une ligne illisible sans bloquer le démarrage', () => {
    store.saveBoardGame('board-casse', '{pas du json');
    expect(() => new BoardGameService(store)).not.toThrow();
    expect(new BoardGameService(store).list()).toEqual([]);
  });

  it('valide la définition avec le même schéma que la sauvegarde', () => {
    expect(boardGameDefinitionSchema.safeParse(plateau()).success).toBe(true);
  });
});

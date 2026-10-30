import type { Level, LevelTheme } from './engine.js';

/**
 * Les trois niveaux de la « Course des sauteurs ». Tous originaux, de difficulté croissante.
 * Légende : `.` air, `#` sol plein, `B` brique, `?` bloc bonus, `=` plateforme traversable par dessous,
 * `^` pointes, `o` pièce, `e` ennemi qui patrouille, `J` ressort, `C` point de contrôle, `S` départ, `F` fanion d'arrivée.
 *
 * Les niveaux sont construits avec un petit pinceau pour rester lisibles, puis figés en lignes de texte.
 */

class Brush {
  private readonly rows: string[][];
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.rows = Array.from({ length: height }, () => Array.from({ length: width }, () => '.'));
  }
  put(col: number, row: number, ch: string): this {
    if (row >= 0 && row < this.height && col >= 0 && col < this.width) this.rows[row]![col] = ch;
    return this;
  }
  /** Remplit le rectangle (col0..col1, row0..row1) inclus. */
  box(col0: number, row0: number, col1: number, row1: number, ch: string): this {
    for (let r = row0; r <= row1; r++) for (let c = col0; c <= col1; c++) this.put(c, r, ch);
    return this;
  }
  /** Plusieurs caractères identiques sur une ligne, aux colonnes données. */
  at(row: number, ch: string, ...cols: number[]): this {
    for (const c of cols) this.put(c, row, ch);
    return this;
  }
  /** Sol plein de la colonne col0 à col1, dont le dessus est la ligne `top`, jusqu'en bas. */
  ground(col0: number, col1: number, top: number): this {
    return this.box(col0, top, col1, this.height - 1, '#');
  }
  /** Efface (air) un rectangle. */
  clear(col0: number, row0: number, col1: number, row1: number): this {
    return this.box(col0, row0, col1, row1, '.');
  }
  /** Mur de fanion : pieds sur la ligne `floor`, `rows` cases de haut. */
  flag(col: number, floor: number, rows: number): this {
    return this.box(col, floor - rows + 1, col, floor, 'F');
  }
  /** Huit départs côte à côte sur la ligne `row`. */
  starts(col0: number, row: number): this {
    for (let i = 0; i < 8; i++) this.put(col0 + i, row, 'S');
    return this;
  }
  tiles(): string[] {
    return this.rows.map((r) => r.join(''));
  }
}

function finish(id: string, name: string, theme: LevelTheme, b: Brush, timeLimit: number): Level {
  const tiles = b.tiles();
  let maxCoins = 0;
  for (const row of tiles) for (const ch of row) if (ch === 'o' || ch === '?') maxCoins++;
  return { id, name, theme, tiles, width: b.width, height: b.height, timeLimit, maxCoins };
}

/** Niveau 1 : « Prairie du matin », une promenade avec trous, escalier, pointes et premiers ennemis. */
function prairie(): Level {
  const W = 150;
  const H = 16;
  const G = 13; // dessus du sol ; les pieds sont sur la ligne G - 1
  const f = G - 1;
  const b = new Brush(W, H);
  b.ground(0, W - 1, G).starts(2, f);
  // Premières pièces et briques.
  b.box(14, f - 2, 18, f - 2, 'o');
  b.at(f - 3, 'B', 24, 26, 28).at(f - 3, '?', 25, 27);
  b.at(f - 7, 'o', 25, 26, 27);
  b.at(f, 'e', 36);
  // Premier trou (3 cases) avec des pièces en arc.
  b.clear(46, G, 48, H - 1).at(f - 3, 'o', 46, 47, 48);
  // Muret de deux cases.
  b.box(58, f - 1, 59, f, '#');
  b.at(f, 'C', 64);
  // Escalier montant puis descendant.
  b.box(72, f, 72, f, '#')
    .box(73, f - 1, 73, f, '#')
    .box(74, f - 2, 74, f, '#')
    .box(75, f - 2, 76, f, '#');
  b.box(77, f - 1, 77, f, '#').box(78, f, 78, f, '#');
  b.at(f - 3, 'o', 74, 75, 76);
  // Deux ennemis qui se suivent.
  b.at(f, 'e', 85, 90);
  // Pointes à enjamber.
  b.at(f, '^', 98, 99);
  b.at(f - 3, 'o', 98, 99);
  // Trou large de 5 cases avec une plateforme au milieu.
  b.clear(104, G, 108, H - 1)
    .box(105, f - 1, 107, f - 1, '=')
    .at(f - 2, 'o', 106);
  b.at(f, 'C', 112);
  // Ressort vers une corniche de pièces (facultatif).
  b.at(f, 'J', 119).box(122, 7, 129, 7, '=').box(122, 6, 129, 6, 'o');
  b.at(f, 'e', 132);
  // Dernier trou et arrivée.
  b.clear(139, G, 141, H - 1);
  b.flag(146, f, 5);
  return finish('prairie', 'Prairie du matin', 'prairie', b, 90);
}

/** Niveau 2 : « Grotte des échos », plafond bas, tunnel d'ennemis, escalade et fosses à pointes. */
function grotte(): Level {
  const W = 170;
  const H = 17;
  const G = 14;
  const f = G - 1;
  const b = new Brush(W, H);
  b.ground(0, W - 1, G)
    .box(0, 0, W - 1, 2, '#')
    .starts(2, f);
  // Stalactites (au-dessus de la zone de saut : elles ne gênent jamais la course).
  for (const [c, len] of [
    [8, 2],
    [15, 4],
    [22, 3],
    [29, 5],
    [36, 3],
    [50, 4],
    [118, 3],
    [128, 5],
    [137, 3],
    [152, 4],
  ] as const) {
    b.box(c, 3, c, 2 + len, '#');
  }
  b.box(12, f - 2, 18, f - 2, 'o');
  b.at(f, 'e', 26, 33);
  b.at(f - 3, '?', 31).at(f - 3, 'B', 30, 32);
  // Fosse de 7 cases : deux plateformes, pointes au fond.
  b.clear(38, G, 44, H - 1).box(38, H - 1, 44, H - 1, '^');
  b.box(40, f - 2, 41, f - 2, '=').at(f - 3, 'o', 40, 41);
  b.at(f, 'C', 50);
  // Tunnel bas (3 cases de haut) avec deux ennemis.
  b.box(55, 3, 76, f - 3, '#');
  b.at(f, 'e', 62, 70).at(f - 1, 'o', 66, 67, 68);
  b.at(f, 'C', 78);
  // Escalade de plateformes au-dessus de pointes, jusqu'à une corniche haute.
  b.at(f, '^', 83, 84, 88, 89, 93, 94);
  b.box(80, 12, 82, 12, '=').box(85, 10, 87, 10, '=').box(90, 8, 92, 8, '=').box(95, 6, 97, 6, '=');
  b.at(11, 'o', 81).at(9, 'o', 86).at(7, 'o', 91).at(5, 'o', 96);
  b.box(98, 6, 110, 7, '#');
  b.at(5, 'C', 99).at(5, 'e', 104).at(5, 'o', 102, 103, 106).at(5, '^', 108);
  b.ground(111, W - 1, G);
  b.at(f, 'C', 116);
  // Ressort vers une corniche de pièces (facultatif).
  b.at(f, 'J', 124).box(127, 8, 133, 8, '=').box(127, 7, 133, 7, 'o');
  b.at(f, 'e', 139).at(f, '^', 149, 150);
  // Trou de 3 cases à franchir en courant.
  b.clear(141, G, 143, H - 1);
  b.at(f, 'e', 154).at(f - 3, 'o', 151, 152, 153);
  b.at(f, '^', 160, 161);
  b.flag(166, f, 5);
  return finish('grotte', 'Grotte des échos', 'grotte', b, 105);
}

/** Niveau 3 : « Îles du vent », îles de nuages, vide partout, ressort obligatoire et grand saut. */
function ciel(): Level {
  const W = 190;
  const H = 18;
  const b = new Brush(W, H);
  const island = (c0: number, c1: number, top: number): void => {
    b.box(c0, top, c1, top + 1, '#');
  };
  // Île de départ.
  island(0, 19, 14);
  b.starts(2, 13);
  b.at(10, 'o', 12, 13, 14);
  // Île 2 avec un ennemi.
  island(23, 32, 14);
  b.at(13, 'e', 28).at(10, 'o', 26, 27, 28, 29);
  // Île à ressort : seule issue vers la haute île.
  island(35, 38, 14);
  b.at(13, 'J', 36);
  island(39, 54, 8);
  b.at(7, 'o', 46, 47, 48).at(7, 'C', 44);
  // Descente par îles de plus en plus basses.
  island(58, 64, 11);
  b.at(10, 'e', 61);
  island(68, 74, 13);
  b.at(12, '^', 70, 71);
  b.at(8, 'o', 70, 71);
  // Nuages-marchepieds d'une case.
  for (const c of [78, 82, 86, 90]) b.put(c, 13, '=');
  b.at(11, 'o', 80, 84, 88);
  island(94, 104, 13);
  b.at(12, 'C', 96).at(12, 'e', 101);
  // Escalier de nuages montant.
  island(107, 111, 12);
  island(114, 118, 10);
  island(121, 130, 8);
  b.at(7, 'e', 125).at(7, 'o', 123, 124);
  b.at(4, '?', 127).at(4, 'B', 126, 128);
  // Grand saut de 4 cases.
  island(134, 142, 8);
  b.at(7, 'C', 136);
  island(147, 153, 10);
  b.at(9, 'o', 144, 145);
  // Descente vers l'île finale, avec des ennemis et des pointes.
  island(157, 173, 12);
  b.at(11, 'C', 158).at(11, 'e', 163, 168).at(11, '^', 166, 171);
  island(177, 189, 13);
  b.at(12, 'o', 179, 180, 181);
  b.flag(186, 12, 5);
  return finish('ciel', 'Îles du vent', 'ciel', b, 120);
}

export const LEVELS: readonly Level[] = [prairie(), grotte(), ciel()];

/** Nombre maximal de pièces par niveau (même ordre que `LEVELS`) : le serveur borne les résultats avec. */
export const LEVEL_MAX_COINS: readonly number[] = LEVELS.map((l) => l.maxCoins);

export function levelById(id: string): Level | undefined {
  return LEVELS.find((l) => l.id === id);
}

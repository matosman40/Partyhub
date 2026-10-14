import { createSoloGame } from './engine.js';
import { sudokuEngine, type SudokuBoard } from './sudoku.js';
import { solitaireEngine, type KlondikeBoard } from './klondike.js';
import { taquinEngine, type TaquinBoard } from './taquin.js';
import { crosswordEngine, type CrosswordBoard } from './crossword.js';

/** Les quatre jeux solo, prêts à être ajoutés au registre. */

export const sudoku = createSoloGame<SudokuBoard>({
  id: 'sudoku',
  name: 'Sudoku',
  icon: '🔢',
  description: 'Remplissez la grille : chaque ligne, colonne et bloc de 3×3 doit contenir de 1 à 9.',
  durationMin: 15,
  notice: {
    goal: 'Remplir la grille 9×9 le plus vite possible.',
    steps: [
      'Choisissez une case vide sur votre téléphone.',
      'Tapez un chiffre de 1 à 9. Les chiffres déjà donnés ne se modifient pas.',
      'Les chiffres en conflit avec une autre case de même ligne, colonne ou bloc sont signalés en rouge.',
      'Terminez la grille : le temps de résolution détermine le classement.',
    ],
    tips: [
      'Chaque grille a une seule solution, et tout le monde joue la même.',
      'Le classement suit le temps : un joueur qui finit en premier prend la tête.',
    ],
  },
  engine: sudokuEngine,
});

export const solitaire = createSoloGame<KlondikeBoard>({
  id: 'solitaire',
  name: 'Solitaire',
  icon: '🂡',
  description: 'Classez toutes les cartes par couleur, de l’As au Roi, en construisant les colonnes.',
  durationMin: 12,
  notice: {
    goal: 'Placer les 52 cartes sur les quatre fondations.',
    steps: [
      'Piochez une carte pour la mettre dans la défausse.',
      'Touchez une carte, puis touchez son emplacement : une colonne ou une fondation.',
      'Les colonnes se construisent en ordre décroissant et en alternant rouge et noir.',
      'Les fondations se remplissent de l’As au Roi, par couleur.',
    ],
    tips: ['Retournez les cartes cachées des colonnes pour avancer.', 'Un roi peut occuper une colonne vide.'],
  },
  engine: solitaireEngine,
});

export const taquin = createSoloGame<TaquinBoard>({
  id: 'taquin',
  name: 'Taquin',
  icon: '🧩',
  description: 'Remettez les tuiles dans l’ordre en les faisant glisser vers la case vide.',
  durationMin: 10,
  notice: {
    goal: 'Remettre les tuiles dans l’ordre, de 1 à la dernière, la case vide en bas à droite.',
    steps: [
      'Touchez une tuile voisine de la case vide : elle glisse dans le vide.',
      'Répétez pour réordonner les tuiles.',
      'Le classement suit le nombre de secondes pour résoudre la grille.',
    ],
    tips: ['Commencez par la première ligne, puis la deuxième, et ainsi de suite.', 'Le mélange est toujours soluble.'],
  },
  engine: taquinEngine,
});

export const motsCroises = createSoloGame<CrosswordBoard>({
  id: 'mots-croises',
  name: 'Mots croisés',
  icon: '✏️',
  description: 'Une grille de mots croisés à remplir à partir des définitions.',
  durationMin: 15,
  notice: {
    goal: 'Remplir toute la grille à partir des définitions.',
    steps: [
      'Touchez une case, puis tapez une lettre : le curseur passe à la case suivante.',
      'Les définitions « horizontal » et « vertical » sont listées sous la grille.',
      'Vérifiez votre grille : les lettres fausses sont signalées en rouge.',
    ],
    tips: [
      'Une case qui porte un numéro commence un mot.',
      'Les lettres communes à deux mots se vérifient mutuellement.',
    ],
  },
  engine: crosswordEngine,
});

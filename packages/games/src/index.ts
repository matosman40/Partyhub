import type { GameModule } from '@partyhub/shared';
import { quizParty } from './quiz-party/module.js';
import { association } from './association/module.js';
import { plutotQui } from './plutot-qui/module.js';
import { imposteur } from './imposteur/module.js';
import { plusOuMoins } from './plus-ou-moins/module.js';
import { reflexe } from './reflexe/module.js';
import { bombesParty } from './bombes-party/module.js';
import { createCardGame } from './cards/engine.js';
import { cardGamePresets } from './cards/presets.js';
import { president } from './president/module.js';
import { promoteur } from './promoteur/module.js';
import { loupsVillage } from './loups-village/module.js';
import { sudoku, solitaire, taquin, motsCroises } from './solo/index.js';
import { rami51 } from './rami51/module.js';
import { tarot } from './tarot/module.js';

/**
 * Registre explicite des jeux disponibles.
 * Ajouter un jeu = créer son dossier puis l'ajouter ICI (aucun chargement
 * dynamique depuis le disque ou la configuration). Voir docs/ADDING-A-GAME.md.
 */
export const gameRegistry: GameModule[] = [
  quizParty,
  association,
  plutotQui,
  imposteur,
  plusOuMoins,
  reflexe,
  bombesParty,
  createCardGame(cardGamePresets['cartes-couleurs'], { id: 'cartes-couleurs' }),
  createCardGame(cardGamePresets['cartes-coco'], { id: 'cartes-coco' }),
  president,
  promoteur,
  loupsVillage,
  sudoku,
  solitaire,
  taquin,
  motsCroises,
  rami51,
  tarot,
];

export function findGame(id: string): GameModule | undefined {
  return gameRegistry.find((g) => g.manifest.id === id);
}

export { quizParty } from './quiz-party/module.js';
export type { QuizSettings, QuizState } from './quiz-party/module.js';
export { association } from './association/module.js';
export { plutotQui } from './plutot-qui/module.js';
export { imposteur } from './imposteur/module.js';
export { plusOuMoins } from './plus-ou-moins/module.js';
export { reflexe } from './reflexe/module.js';
export { bombesParty } from './bombes-party/module.js';
export type { BombesPartyState, BombesPartySettings } from './bombes-party/module.js';
export { createCardGame, canPlayCard } from './cards/engine.js';
export type { CardGameState, CardInstance, CardPhase } from './cards/engine.js';
export { cardGamePresets, cartesCouleurs, blancMangerCoco } from './cards/presets.js';
export { president, createPresidentGame } from './president/module.js';
export type { PresidentState, PresidentSettings } from './president/module.js';
export { validatePlay, rankValue, RANKS, PRESIDENT_DEFINITION } from './president/rules.js';
export { promoteur } from './promoteur/module.js';
export type { PromoteurState, PromoteurSettings } from './promoteur/module.js';
export { loupsVillage } from './loups-village/module.js';
export type { LoupsState, LoupsSettings } from './loups-village/module.js';
export { cellOf, nextSquare, stepsBetween, BOARD_SIZE } from './promoteur/board.js';
export { createMediaQuiz, mediaRanking, type MediaQuizSettings, type MediaQuizState } from './media-quiz/module.js';
export { createMediaGame } from './media-game.js';
export * from './solo/index.js';
export { createCaptionGame, type CaptionState, type CaptionSettings } from './captions/module.js';
export { matchAnswer, normalizeAnswer, editDistance } from './media-quiz/answer.js';
export { rami51, createRamiGame, ramiSettingsSchema } from './rami51/module.js';
export type { RamiState, RamiSettings, RamiPhase, RamiRoundResult } from './rami51/module.js';
export {
  RAMI_DEFINITION,
  RAMI_NOTICE,
  checkMeld,
  checkLayoff,
  checkSwap,
  checkOpening,
  handPenalty,
  penaltyValue,
  positionValue,
  meldPoints,
  meldTitle,
  jokerText,
  fullDeck,
  sortCards,
} from './rami51/rules.js';
export type { RamiCard, Meld, MeldCard, MeldCheck, OpeningCheck, SwapCheck } from './rami51/rules.js';
export { planOpening, planMeld, planLayoff, planDiscard, meldCandidates } from './rami51/bot.js';
export { tarot, createTarotGame, tarotSettingsSchema } from './tarot/module.js';
export type { TarotState, TarotSettings, TarotPhase, TarotBid, TarotTrick, TarotSummary, PlayedCard } from './tarot/module.js';
export {
  TAROT_DEFINITION,
  TAROT_DECK,
  TAROT_NOTICE,
  CONTRACTS,
  CONTRACT_LABEL,
  CONTRACT_COEF,
  POINTS_NEEDED,
  TOTAL_HALF_POINTS,
  EXCUSE,
  PETIT,
  VINGT_ET_UN,
  OUDLERS,
  autoEcart,
  canDiscard,
  cardHalfPoints,
  cardName,
  cardSymbol,
  contractsAbove,
  countHalfPoints,
  dealDeltas,
  ecartError,
  formatHalf,
  hasPetitSec,
  isOudler,
  legalCards,
  playError,
  scoreDeal,
  sortHand,
  trickWinner,
} from './tarot/rules.js';
export type { Contract, DealInput, DealScore, Side } from './tarot/rules.js';
export { botBid, botEcart, botPlay, handStrength } from './tarot/bot.js';

export { createBoardGame, boardSettingsSchema } from './board/module.js';
export type { BoardState, BoardSettings } from './board/module.js';
export { playTurn as playBoardTurn, ranking as boardRanking, rollDice as boardRollDice, currentPlayer as boardCurrentPlayer } from './board/rules.js';

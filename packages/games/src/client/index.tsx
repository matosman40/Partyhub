import { QuizHost } from '../quiz-party/client/HostScreen.js';
import { QuizPlayer } from '../quiz-party/client/PlayerScreen.js';
import { QuizSettings } from '../quiz-party/client/Settings.js';
import { AssociationHost } from '../association/client/HostScreen.js';
import { AssociationPlayer } from '../association/client/PlayerScreen.js';
import { PlutotQuiHost } from '../plutot-qui/client/HostScreen.js';
import { PlutotQuiPlayer } from '../plutot-qui/client/PlayerScreen.js';
import { ImposteurHost } from '../imposteur/client/HostScreen.js';
import { ImposteurPlayer } from '../imposteur/client/PlayerScreen.js';
import { PlusOuMoinsHost } from '../plus-ou-moins/client/HostScreen.js';
import { PlusOuMoinsPlayer } from '../plus-ou-moins/client/PlayerScreen.js';
import { ReflexeHost } from '../reflexe/client/HostScreen.js';
import { ReflexePlayer } from '../reflexe/client/PlayerScreen.js';
import { BombesPartyHost } from '../bombes-party/client/HostScreen.js';
import { BombesPartyPlayer } from '../bombes-party/client/PlayerScreen.js';
import { fieldSettings } from './settings.js';
import { cardViews } from '../cards/client/index.js';
import { presidentViews } from '../president/client/index.js';
import { PromoteurHost } from '../promoteur/client/HostScreen.js';
import { PromoteurPlayer } from '../promoteur/client/PlayerScreen.js';
import { LoupsHostScreen } from '../loups-village/client/HostScreen.js';
import { LoupsPlayerScreen } from '../loups-village/client/PlayerScreen.js';
import { soloClientViews } from '../solo/client/index.js';
import type { GameClientViews } from './types.js';
import { ramiViews } from '../rami51/client/index.js';
import { pokerViews } from '../poker/client/index.js';
import { tarotViews } from '../tarot/client/index.js';

export type { GameClientViews, HostViewProps, PlayerViewProps, SettingsProps } from './types.js';
export { Avatar } from './ui.js';
export { AvatarsContext } from './avatar-context.js';
export type { AvatarData } from './avatar-context.js';
export { useWakeLock, vibrate, canVibrate } from './device.js';
export { isMuted, setMuted, startMusic, stopMusic, unlockAudio } from './audio.js';
export { SoundToggle } from './SoundToggle.js';
export { cardViews } from '../cards/client/index.js';
export { cardGamePresets } from '../cards/presets.js';
export { validatePlay, rankValue, RANKS, PRESIDENT_DEFINITION } from '../president/rules.js';
export { CardFace } from '../cards/client/CardFace.js';
export { entryOf, familyOf, rankingOf } from '../cards/client/common.js';
export type { CardsPublic, CardsPlayerState } from '../cards/client/common.js';

/**
 * Vues navigateur de chaque jeu, indexées par identifiant de jeu.
 * Un nouveau jeu doit ajouter son entrée ici (voir docs/ADDING-A-GAME.md).
 */
export const clientViews: Record<string, GameClientViews> = {
  'quiz-party': {
    Settings: QuizSettings,
    Host: QuizHost,
    Player: QuizPlayer,
  },
  association: {
    Settings: fieldSettings([
      { key: 'rounds', label: 'Manches', min: 1, max: 10 },
      { key: 'writeSeconds', label: 'Secondes pour écrire', min: 10, max: 120 },
    ]),
    Host: AssociationHost,
    Player: AssociationPlayer,
  },
  'plutot-qui': {
    Settings: fieldSettings([
      { key: 'rounds', label: 'Questions', min: 1, max: 15 },
      { key: 'voteSeconds', label: 'Secondes pour voter', min: 10, max: 90 },
    ]),
    Host: PlutotQuiHost,
    Player: PlutotQuiPlayer,
  },
  imposteur: {
    Settings: fieldSettings([{ key: 'rounds', label: 'Manches', min: 1, max: 8 }]),
    Host: ImposteurHost,
    Player: ImposteurPlayer,
  },
  'plus-ou-moins': {
    Settings: fieldSettings([
      { key: 'rounds', label: 'Cartes', min: 1, max: 30 },
      { key: 'betSeconds', label: 'Secondes pour parier', min: 5, max: 60 },
    ]),
    Host: PlusOuMoinsHost,
    Player: PlusOuMoinsPlayer,
  },
  reflexe: {
    Settings: fieldSettings([{ key: 'rounds', label: 'Manches', min: 1, max: 15 }]),
    Host: ReflexeHost,
    Player: ReflexePlayer,
  },
  'bombes-party': {
    Settings: fieldSettings([{ key: 'rounds', label: 'Manches', min: 1, max: 5 }]),
    Host: BombesPartyHost,
    Player: BombesPartyPlayer,
  },
  'cartes-couleurs': cardViews,
  'cartes-coco': cardViews,
  president: presidentViews,
  promoteur: {
    Settings: fieldSettings([
      { key: 'rounds', label: 'Tours', min: 5, max: 60 },
      { key: 'turnSeconds', label: 'Secondes par tour (0 = libre)', min: 0, max: 120 },
    ]),
    Host: PromoteurHost,
    Player: PromoteurPlayer,
  },
  'loups-village': {
    Settings: fieldSettings([{ key: 'debateSeconds', label: 'Secondes de débat', min: 30, max: 300 }]),
    Host: LoupsHostScreen,
    Player: LoupsPlayerScreen,
  },
  ...soloClientViews,
  'rami-51': ramiViews,
  poker: pokerViews,
  tarot: tarotViews,
};

// Briques partagées avec la vue 3D du Promoteur (écran TV, chargement différé côté web).
export { cellOf, GROUP_COLOR, GROUP_LABEL, STACK_OFFSETS, groupSquares } from '../promoteur/board.js';
export type { Group } from '../promoteur/board.js';
export type { PlayerPub, PromoteurPub, TilePub } from '../promoteur/client/types.js';
export { useSteppedPositions } from '../promoteur/client/useStepped.js';
export { usePrefersReducedMotion } from './motion.js';
export { useRemaining } from './hooks.js';
export { TimerBar } from './ui.js';
export { mediaQuizViews } from '../media-quiz/client/index.js';

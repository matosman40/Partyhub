import { fieldSettings } from './settings.js';
import { lazyViews } from './lazy-views.js';
import type { GameClientViews } from './types.js';

export type { GameClientViews, HostViewProps, PlayerViewProps, SettingsProps } from './types.js';
export { Avatar } from './ui.js';
export { AvatarsContext, MoodsContext } from './avatar-context.js';
export type { AvatarData } from './avatar-context.js';
export { Character } from './character.js';
export { Plateau, PLATEAU_KEY_STEP } from './plateau.js';
export type { PlateauFigure, PlateauProps } from './plateau.js';
export { PrairieScene } from './plateau-scene.js';
export type { CharacterProps } from './character.js';
export { PackFigure, packAtlasUrl, PACK_BUST_FACE, PACK_FULL_POSE } from './character-pack-figure.js';
export type { PackFigureProps } from './character-pack-figure.js';
export { refreshCharacterPacks, useCharacterPacks, usePackInfo } from './character-packs.js';
export type { CharacterPackState } from './character-packs.js';
export { useWakeLock, vibrate, canVibrate } from './device.js';
export {
  audioConstraints,
  canUseMedia,
  parseMediaPrefs,
  readMediaPrefs,
  requestCamera,
  requestMicrophone,
  saveMediaPrefs,
  useMediaPrefs,
  videoConstraints,
  EMPTY_MEDIA_PREFS,
  MEDIA_PREFS_EVENT,
  MEDIA_PREFS_KEY,
} from './media.js';
export type { MediaPrefs } from './media.js';
export { isMuted, onMuteChange, setMuted, setSfxFiles, startMusic, stopMusic, unlockAudio } from './audio.js';
export { SoundToggle } from './SoundToggle.js';
export {
  motionAvailable,
  motionNeedsPermission,
  requestMotionAccess,
  SensorsContext,
  SensorSenderContext,
  useMicLevel,
  useMotionFeed,
  useSensorBroadcast,
  useSensors,
} from './sensors.js';
export type { MicStatus, MotionAccess, MotionFrame, SensorReading, SignalState } from './sensors.js';
export {
  angleDelta,
  GRAVITY,
  HoldTimer,
  levelFromBytes,
  Pulses,
  ShakeDetector,
  SpinTracker,
  Throttle,
  TILT_FULL_DEG,
  tiltFrom,
} from './sensors-core.js';
// Banques BOUM ! : libellés, types et règles de saisie, partagés avec l'administration et le profil.
export { BANK_TYPES, BANK_TYPE_INFO, LEVELS, LEVEL_LABELS, STATUSES, STATUS_LABELS } from '../boum/bank/types.js';
export type { AnswerRule, BankType, EntryStatus, Level } from '../boum/bank/types.js';
export type { ImportCandidate, ImportPreview, ImportRejection } from '../boum/bank/validate.js';
export { cardGamePresets } from '../cards/presets.js';
export { cardGameTemplates, type CardGameTemplate } from '../cards/templates.js';
export { validatePlay, rankValue, RANKS, PRESIDENT_DEFINITION } from '../president/rules.js';
export { CardFace } from '../cards/client/CardFace.js';
export { assetFontFamily } from '../cards/client/fonts.js';
export { entryOf, familyOf, rankingOf } from '../cards/client/common.js';
export type { CardsPublic, CardsPlayerState } from '../cards/client/common.js';

/*
 * Chaque jeu est chargé à la demande (découpage du bundle) : le navigateur ne télécharge
 * le code d'un jeu que lorsqu'on le règle, l'affiche ou le joue. Les vues rendues par les
 * pages doivent donc être sous une frontière Suspense.
 */

/** Vues communes à tous les jeux de cartes (intégrés et personnalisés). */
export const cardViews = lazyViews(() => import('../cards/client/index.js').then((m) => m.cardViews));

/** Vues communes à tous les jeux de plateau (intégrés et personnalisés). */
export const boardViews = lazyViews(() => import('../board/client/index.js').then((m) => m.boardViews));

/** Vues communes à tous les jeux de questions médias (chacun a sa définition côté serveur). */
export const mediaQuizViews = lazyViews(() => import('../media-quiz/client/index.js').then((m) => m.mediaQuizViews));

const soloViews = (id: string) =>
  lazyViews(() => import('../solo/client/index.js').then((m) => m.soloClientViews[id]!));

/**
 * Vues navigateur de chaque jeu, indexées par identifiant de jeu.
 * Un nouveau jeu doit ajouter son entrée ici (voir docs/ADDING-A-GAME.md).
 */
export const clientViews: Record<string, GameClientViews> = {
  'quiz-party': lazyViews(async () => {
    const [{ QuizHost }, { QuizPlayer }, { QuizSettings }] = await Promise.all([
      import('../quiz-party/client/HostScreen.js'),
      import('../quiz-party/client/PlayerScreen.js'),
      import('../quiz-party/client/Settings.js'),
    ]);
    return { Settings: QuizSettings, Host: QuizHost, Player: QuizPlayer };
  }),
  'phrases-trous': lazyViews(async () => {
    const [{ PhrasesHost }, { PhrasesPlayer }, { PhrasesSettings }] = await Promise.all([
      import('../phrases-trous/client/HostScreen.js'),
      import('../phrases-trous/client/PlayerScreen.js'),
      import('../phrases-trous/client/Settings.js'),
    ]);
    return { Settings: PhrasesSettings, Host: PhrasesHost, Player: PhrasesPlayer };
  }),
  association: lazyViews(async () => {
    const [{ AssociationHost }, { AssociationPlayer }] = await Promise.all([
      import('../association/client/HostScreen.js'),
      import('../association/client/PlayerScreen.js'),
    ]);
    return {
      Settings: fieldSettings([
        { key: 'rounds', label: 'Manches', min: 1, max: 10 },
        { key: 'writeSeconds', label: 'Secondes pour écrire', min: 10, max: 120 },
      ]),
      Host: AssociationHost,
      Player: AssociationPlayer,
    };
  }),
  'plutot-qui': lazyViews(async () => {
    const [{ PlutotQuiHost }, { PlutotQuiPlayer }] = await Promise.all([
      import('../plutot-qui/client/HostScreen.js'),
      import('../plutot-qui/client/PlayerScreen.js'),
    ]);
    return {
      Settings: fieldSettings([
        { key: 'rounds', label: 'Questions', min: 1, max: 15 },
        { key: 'voteSeconds', label: 'Secondes pour voter', min: 10, max: 90 },
      ]),
      Host: PlutotQuiHost,
      Player: PlutotQuiPlayer,
    };
  }),
  imposteur: lazyViews(async () => {
    const [{ ImposteurHost }, { ImposteurPlayer }] = await Promise.all([
      import('../imposteur/client/HostScreen.js'),
      import('../imposteur/client/PlayerScreen.js'),
    ]);
    return {
      Settings: fieldSettings([{ key: 'rounds', label: 'Manches', min: 1, max: 8 }]),
      Host: ImposteurHost,
      Player: ImposteurPlayer,
    };
  }),
  'micro-defis': lazyViews(async () => {
    const [{ MicroDefisHost }, { MicroDefisPlayer }] = await Promise.all([
      import('../micro-defis/client/HostScreen.js'),
      import('../micro-defis/client/PlayerScreen.js'),
    ]);
    return {
      Settings: fieldSettings([{ key: 'rounds', label: 'Défis', min: 1, max: 12 }]),
      Host: MicroDefisHost,
      Player: MicroDefisPlayer,
    };
  }),
  'gags-en-rafale': lazyViews(async () => {
    const [{ GagsHost }, { GagsPlayer }] = await Promise.all([
      import('../gags-en-rafale/client/HostScreen.js'),
      import('../gags-en-rafale/client/PlayerScreen.js'),
    ]);
    return {
      Settings: fieldSettings([{ key: 'rounds', label: 'Gags', min: 1, max: 20 }]),
      Host: GagsHost,
      Player: GagsPlayer,
    };
  }),
  funambule: lazyViews(async () => {
    const [{ FunambuleHost }, { FunambulePlayer }] = await Promise.all([
      import('../funambule/client/HostScreen.js'),
      import('../funambule/client/PlayerScreen.js'),
    ]);
    return {
      Settings: fieldSettings([{ key: 'rounds', label: 'Manches', min: 1, max: 6 }]),
      Host: FunambuleHost,
      Player: FunambulePlayer,
    };
  }),
  'aventure-ia': lazyViews(async () => {
    const [{ AventureHost }, { AventurePlayer }, { AventureSettings }] = await Promise.all([
      import('../aventure/client/HostScreen.js'),
      import('../aventure/client/PlayerScreen.js'),
      import('../aventure/client/Settings.js'),
    ]);
    return {
      Settings: AventureSettings,
      Host: AventureHost,
      Player: AventurePlayer,
    };
  }),
  'plus-ou-moins': lazyViews(async () => {
    const [{ PlusOuMoinsHost }, { PlusOuMoinsPlayer }] = await Promise.all([
      import('../plus-ou-moins/client/HostScreen.js'),
      import('../plus-ou-moins/client/PlayerScreen.js'),
    ]);
    return {
      Settings: fieldSettings([
        { key: 'rounds', label: 'Cartes', min: 1, max: 30 },
        { key: 'betSeconds', label: 'Secondes pour parier', min: 5, max: 60 },
      ]),
      Host: PlusOuMoinsHost,
      Player: PlusOuMoinsPlayer,
    };
  }),
  reflexe: lazyViews(async () => {
    const [{ ReflexeHost }, { ReflexePlayer }] = await Promise.all([
      import('../reflexe/client/HostScreen.js'),
      import('../reflexe/client/PlayerScreen.js'),
    ]);
    return {
      Settings: fieldSettings([{ key: 'rounds', label: 'Manches', min: 1, max: 15 }]),
      Host: ReflexeHost,
      Player: ReflexePlayer,
    };
  }),
  'imite-moi': lazyViews(async () => {
    const [{ ImiteHost }, { ImitePlayer }, { ImiteSettings }] = await Promise.all([
      import('../imite-moi/client/HostScreen.js'),
      import('../imite-moi/client/PlayerScreen.js'),
      import('../imite-moi/client/Settings.js'),
    ]);
    return { Settings: ImiteSettings, Host: ImiteHost, Player: ImitePlayer };
  }),
  'bombes-party': lazyViews(async () => {
    const [{ BombesPartyHost }, { BombesPartyPlayer }] = await Promise.all([
      import('../bombes-party/client/HostScreen.js'),
      import('../bombes-party/client/PlayerScreen.js'),
    ]);
    return {
      Settings: fieldSettings([{ key: 'rounds', label: 'Manches', min: 1, max: 5 }]),
      Host: BombesPartyHost,
      Player: BombesPartyPlayer,
    };
  }),
  banquise: lazyViews(async () => {
    const [{ BanquiseHost }, { BanquisePlayer }, { BanquiseSettings }] = await Promise.all([
      import('../banquise/client/HostScreen.js'),
      import('../banquise/client/PlayerScreen.js'),
      import('../banquise/client/Settings.js'),
    ]);
    return { Settings: BanquiseSettings, Host: BanquiseHost, Player: BanquisePlayer };
  }),
  boum: lazyViews(async () => {
    const [{ BoumHost }, { BoumPlayer }, { BoumSettings }] = await Promise.all([
      import('../boum/client/HostScreen.js'),
      import('../boum/client/PlayerScreen.js'),
      import('../boum/client/Settings.js'),
    ]);
    return { Settings: BoumSettings, Host: BoumHost, Player: BoumPlayer };
  }),
  'cartes-couleurs': cardViews,
  'cartes-coco': cardViews,
  president: lazyViews(() => import('../president/client/index.js').then((m) => m.presidentViews)),
  promoteur: lazyViews(async () => {
    const [{ PromoteurHost }, { PromoteurPlayer }] = await Promise.all([
      import('../promoteur/client/HostScreen.js'),
      import('../promoteur/client/PlayerScreen.js'),
    ]);
    return {
      Settings: fieldSettings([
        { key: 'rounds', label: 'Tours', min: 5, max: 60 },
        { key: 'turnSeconds', label: 'Secondes par tour (0 = libre)', min: 0, max: 120 },
      ]),
      Host: PromoteurHost,
      Player: PromoteurPlayer,
    };
  }),
  'loups-village': lazyViews(async () => {
    const [{ LoupsHostScreen }, { LoupsPlayerScreen }] = await Promise.all([
      import('../loups-village/client/HostScreen.js'),
      import('../loups-village/client/PlayerScreen.js'),
    ]);
    return {
      Settings: fieldSettings([{ key: 'debateSeconds', label: 'Secondes de débat', min: 30, max: 300 }]),
      Host: LoupsHostScreen,
      Player: LoupsPlayerScreen,
    };
  }),
  sudoku: soloViews('sudoku'),
  solitaire: soloViews('solitaire'),
  taquin: soloViews('taquin'),
  'mots-croises': soloViews('mots-croises'),
  'rami-51': lazyViews(() => import('../rami51/client/index.js').then((m) => m.ramiViews)),
  tarot: lazyViews(() => import('../tarot/client/index.js').then((m) => m.tarotViews)),
  'poker-texas': lazyViews(() => import('../poker/client/index.js').then((m) => m.pokerViews)),
};

// Briques partagées avec la vue 3D du Promoteur (écran TV, chargement différé côté web).
export { cellOf, GROUP_COLOR, GROUP_LABEL, STACK_OFFSETS, groupSquares } from '../promoteur/board.js';
export type { Group } from '../promoteur/board.js';
export type { PlayerPub, PromoteurPub, TilePub } from '../promoteur/client/types.js';
export { useSteppedPositions } from '../promoteur/client/useStepped.js';
export { usePrefersReducedMotion } from './motion.js';
export { useRemaining } from './hooks.js';
export { TimerBar } from './ui.js';

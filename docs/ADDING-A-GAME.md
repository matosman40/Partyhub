# Ajouter un jeu à PartyHub

Un jeu est un module indépendant. Le cœur de PartyHub (salles, connexions, scores, administration)
n'est jamais modifié : on ajoute un dossier, puis on l'enregistre dans **deux** registres explicites.

Exemple complet : **Vote Express**, un sondage à choix multiples. Chaque joueur vote sur son téléphone,
l'écran principal affiche les résultats. Il sert de modèle pour tout nouveau jeu.

## Étape 1 : le module serveur

Créer `packages/games/src/vote-express/module.ts` :

```ts
import { z } from 'zod';
import type { GameModule } from '@partyhub/shared';

const settingsSchema = z.object({
  question: z.string().min(3).max(200).default('Votre choix ?'),
  options: z.array(z.string().min(1).max(40)).min(2).max(4).default(['Oui', 'Non']),
});

export type VoteSettings = z.infer<typeof settingsSchema>;

export interface VoteState {
  settings: VoteSettings;
  phase: 'ready' | 'voting' | 'final';
  names: Record<string, string>;
  votes: Record<string, number>;
}

export const voteExpress: GameModule<VoteState, VoteSettings> = {
  manifest: {
    id: 'vote-express',          // identifiant unique, en minuscules
    category: 'quiz',            // 'cartes' | 'plateau' | 'quiz' | 'role' (filtre de l'accueil)
    name: 'Vote Express',
    description: 'Un sondage rapide : chacun vote depuis son téléphone.',
    icon: '🗳️',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 1,
    maxPlayers: 12,
    durationMin: 3,
  },

  settingsSchema,
  defaultSettings: settingsSchema.parse({}),

  // Chaque action acceptée des joueurs, avec le schéma de son payload.
  // Le moteur valide le payload AVANT d'appeler handleAction.
  actions: {
    vote: z.object({ choice: z.number().int().min(0).max(3) }),
  },

  initialize(settings, players) {
    return {
      settings: settingsSchema.parse(settings),
      phase: 'ready',
      names: Object.fromEntries(players.map((p) => [p.id, p.name])),
      votes: {},
    };
  },

  onPlayerJoin(s, p) {
    return { ...s, names: { ...s.names, [p.id]: p.name } };
  },

  onPlayerLeave(s, p) {
    const names = { ...s.names };
    delete names[p.id];
    return { ...s, names };
  },

  start(s) {
    if (s.phase !== 'ready') return { ok: false, error: 'La partie a déjà commencé' };
    return { ok: true, state: { ...s, phase: 'voting' } };
  },

  handleAction(s, p, type, payload) {
    if (type !== 'vote') return { ok: false, error: 'Action inconnue' };
    if (s.phase !== 'voting') return { ok: false, error: 'Vote fermé' };
    if (p.id in s.votes) return { ok: false, error: 'Vous avez déjà voté' };
    const { choice } = payload as { choice: number };
    if (choice >= s.settings.options.length) return { ok: false, error: 'Choix invalide' };
    return { ok: true, state: { ...s, votes: { ...s.votes, [p.id]: choice } } };
  },

  // Aucun minuteur dans cet exemple : onTimer renvoie l'état inchangé.
  onTimer: (s) => s,

  nextRound: (s) => ({ ...s, phase: 'final' }),

  // Pas de score dans un sondage : liste vide.
  calculateScores: () => [],

  end: (s) => ({ ...s, phase: 'final' }),

  // Vue visible par tous : jamais les votes individuels.
  getPublicState(s) {
    const counts = s.settings.options.map((_, i) => Object.values(s.votes).filter((v) => v === i).length);
    return {
      phase: s.phase,
      question: s.settings.question,
      options: s.settings.options,
      counts,
      voted: Object.keys(s.votes).length,
      total: Object.keys(s.names).length,
    };
  },

  // Vue privée : seulement le vote du joueur concerné.
  getPlayerState: (s, playerId) => ({ myVote: s.votes[playerId] ?? null }),

  getHostState: (s) => ({ pending: Object.keys(s.names).filter((id) => !(id in s.votes)).map((id) => s.names[id]) }),

  isFinished: (s) => s.phase === 'final',
};
```

Points à respecter :

- Le module **ne touche jamais** à une autre salle : il ne reçoit que son état et un `GameContext` restreint.
- Retourner un **nouvel** objet d'état ; ne pas muter `s`.
- Ne jamais mettre dans `getPublicState` une donnée que tous ne doivent pas voir (ici, les votes individuels).
- Les erreurs métier se renvoient avec `{ ok: false, error }` : le message est affiché tel quel au joueur, en français.

## Étape 2 : les vues navigateur

Créer `packages/games/src/vote-express/client/` avec trois composants : réglages, écran principal, téléphone.

`Settings.tsx` (réglages dans le salon, avant la partie) :

```tsx
import type { SettingsProps } from '../../client/types.js';

export function VoteSettings({ settings, disabled, onChange }: SettingsProps) {
  const question = String(settings.question ?? '');
  return (
    <label className="field">
      <span>Question</span>
      <input
        value={question}
        disabled={disabled}
        maxLength={200}
        onChange={(e) => onChange({ ...settings, question: e.target.value })}
      />
    </label>
  );
}
```

`HostScreen.tsx` (écran principal) :

```tsx
import type { HostViewProps } from '../../client/types.js';

export function VoteHost({ publicState: pub }: HostViewProps) {
  if (!pub) return null;
  const max = Math.max(1, ...(pub.counts as number[]));
  return (
    <section className="quiz-host fade-in">
      <h2 className="question-title">{pub.question}</h2>
      <ol className="choices-grid">
        {pub.options.map((label: string, i: number) => (
          <li key={i} className="choice">
            <span className="choice-label">{label}</span>
            <span className="bar" style={{ width: `${(pub.counts[i] / max) * 100}%` }} />
            <span className="count">{pub.counts[i]}</span>
          </li>
        ))}
      </ol>
      <p className="muted">{pub.voted} / {pub.total} ont voté</p>
    </section>
  );
}
```

`PlayerScreen.tsx` (téléphone) :

```tsx
import type { PlayerViewProps } from '../../client/types.js';

export function VotePlayer({ publicState: pub, playerState: me, send }: PlayerViewProps) {
  if (!pub) return null;
  const answered = me?.myVote !== null && me?.myVote !== undefined;
  return (
    <section className="player-game fade-in">
      <h2 className="question-small">{pub.question}</h2>
      <div className="choices-stack">
        {pub.options.map((label: string, i: number) => (
          <button
            key={i}
            type="button"
            className={`choice-btn ${me?.myVote === i ? 'selected' : ''}`}
            disabled={answered || pub.phase !== 'voting'}
            onClick={() => send('vote', { choice: i })}
          >
            {label}
          </button>
        ))}
      </div>
      {answered && <p className="notice">Vote enregistré ✔</p>}
    </section>
  );
}
```

## Étape 3 : enregistrer le jeu (deux registres)

1. Côté serveur, `packages/games/src/index.ts` :

```ts
import { voteExpress } from './vote-express/module.js';

export const gameRegistry: GameModule[] = [quizParty, voteExpress];
```

2. Côté navigateur, `packages/games/src/client/index.tsx` :

```ts
import { VoteHost } from '../vote-express/client/HostScreen.js';
import { VotePlayer } from '../vote-express/client/PlayerScreen.js';
import { VoteSettings } from '../vote-express/client/Settings.js';

export const clientViews: Record<string, GameClientViews> = {
  'quiz-party': { Settings: QuizSettings, Host: QuizHost, Player: QuizPlayer },
  'vote-express': { Settings: VoteSettings, Host: VoteHost, Player: VotePlayer },
};
```

L'identifiant (`vote-express`) doit être identique dans `manifest.id` et dans la clé de `clientViews`.

## Étape 4 : compiler, tester, activer

```bash
npm run build          # compile le jeu ; une erreur de type est signalée ici
npm test               # les tests existants doivent toujours passer
```

Ajouter un test dans `packages/server/src/__tests__/` pour la logique du jeu, sur le modèle de `quiz.test.ts` :
appeler directement `voteExpress.initialize`, `start`, `handleAction`, et vérifier qu'un second vote est refusé.

Le jeu apparaît automatiquement dans le catalogue de l'accueil. Il est **activé par défaut** ; l'administration
(`/admin`) permet de le désactiver sans redéployer.

Pour une mise en production : `docker compose up -d --build`, puis vérifier la carte du nouveau jeu sur l'accueil.

## Un plateau de personnages

Pour un jeu où les joueurs se déplacent sur un plan (salon, carte, plateau), le composant `Plateau`
de `@partyhub/games/client` fournit le décor, les personnages déplaçables et les bulles d'émotion.
Le salon l'utilise déjà (`packages/web/src/components/LobbyPlateau.tsx`).

```tsx
import { Plateau, type PlateauFigure } from '@partyhub/games/client';

const figures: PlateauFigure[] = players.map((p) => ({
  id: p.id,
  name: p.name,
  position: p.position,            // fractions 0 à 1 du plateau, envoyées par le serveur
  character: p.avatar.character,   // ou `avatar: <PlayerAvatar … />` pour un avatar non dessiné
  mood: 'idle',                    // pose du personnage
  bubble: null,                    // { emoji, key } pour une émotion, la clé relance son apparition
  mine: p.id === meId,             // seul ce personnage se déplace sous les doigts de l'appareil
}));

<Plateau figures={figures} label="Plateau de la partie" onMove={sendPosition} />;
```

- `onMove` envoie la position au serveur (le même principe que `player:lobby-move` : limite de débit, position
  bornée au cadre). Sans `onMove`, le plateau sert seulement d'affichage (écran principal).
- Le décor est le thème « prairie » (`plateau-scene.tsx`). Un autre thème s'ajoute à côté, sans toucher au
  composant.
- Le plateau de test (`packages/games/src/plateau-test/module.ts`) est un jeu sans partie, non listé au catalogue :
  il sert à essayer le plateau, et ne doit pas être copié tel quel.

## Micro et caméra

Un jeu peut utiliser le micro ou la caméra du téléphone, à condition de le demander au joueur au moment où il en a
besoin. Le SDK `@partyhub/games/client` fournit :

- `useMediaPrefs()` : le micro et la caméra choisis sur cet appareil (dans le profil ou le tiroir d'angle), avec
  `null` pour l'appareil par défaut ;
- `requestMicrophone(prefs)` et `requestCamera(prefs, facing?)` : demandent l'accès à l'appareil choisi. Elles
  rejettent si l'autorisation est refusée ou si la page n'est pas en HTTPS ; prévoyez ce cas.
- `canUseMedia()` : vrai si le navigateur sait demander le micro ou la caméra.

Le flux obtenu appartient au jeu : arrêtez les pistes (`track.stop()`) dès que la vue se ferme. Aucun flux n'est
envoyé au serveur par défaut ; un jeu qui enregistre quoi que ce soit doit le dire dans ses règles.

## Capteurs du téléphone

Un jeu peut utiliser le gyroscope, l'accéléromètre et le micro du téléphone : inclinaison, secousses, rotation, souffle.
Le SDK `@partyhub/games/client` fournit :

- `useMotionFeed(active, onFrame)` : écoute l'orientation et le mouvement tant que `active` est vrai. La pose de départ
  sert de référence (le téléphone doit être tenu comme au début) ; `recalibrate()` la reprend. Chaque mesure donne
  l'inclinaison `tilt` (de -1 à 1 sur chaque axe), l'accélération linéaire `accel` et le cap `alpha`.
- `requestMotionAccess()` : demande l'accès. iOS l'exige depuis un geste (un bouton). Elle renvoie `'granted'`,
  `'denied'`, `'unavailable'` ou `'insecure'` (page sans HTTPS).
- `useMicLevel(active)` : niveau du micro, de 0 à 1. Le micro est arrêté dès que `active` devient faux.
- `useSensorBroadcast(hz)` (sur le téléphone) : envoie `{ x, y, energy }` à l'écran principal, au plus `hz` fois par
  seconde (`SENSOR_SEND_HZ` vaut 30). Le serveur plafonne à quarante messages par seconde et par joueur (`SENSOR_MAX_PER_SECOND`),
  ne les relaie qu'aux écrans de la salle, et seulement pendant une partie (`room:sensor`). Rien n'est enregistré.
- `useSensors()` (sur l'écran principal) : le dernier échantillon de chaque joueur, avec l'instant de réception `at`.
  Les écrans réagissent à chaque lot de mesures : pour ne pas tout redessiner à chaque mesure, un jeu confie les
  éléments qui bougent à un composant qui s'abonne à `useSensors()`, mémoïsé par joueur, et non à la scène entière.
  `isFreshReading` et `useFreshnessTick` donnent la fraîcheur d'une mesure, et un rafraîchissement périodique pour
  qu'une mesure qui vieillit soit revue comme périmée.
- Les détections pures (`ShakeDetector`, `HoldTimer`, `SpinTracker`, `Pulses`, `Throttle`, `tiltFrom`) se testent sans
  navigateur, comme dans `packages/games/src/client/sensors-core.ts`.

Quelques règles, tirées de Micro-Défis et de Funambule :

- Un téléphone peut ne pas avoir de capteur, ou la page peut être en HTTP. Prévoyez alors une autre manière de jouer
  (« Tapote vite » ne demande aucun capteur) ou un message clair, sans bloquer la partie.
- Le téléphone mesure son propre mouvement, mais le serveur ne peut pas le voir. Il borne donc la valeur reçue par le
  temps réellement écoulé, comme `judge` (`micro-defis/microgames.ts`) et `judgeWalk` (`funambule/rules.ts`). Une valeur
  plus grande que le temps écoulé n'est jamais crue.
- Un défi se joue en même temps pour tous : le serveur fixe le début (`startedAt`), et chaque téléphone le recale sur
  son horloge locale avec `useLocalStart`. Le serveur ne publie jamais le résultat avant le bilan.

## Ce qu'un jeu ne peut pas faire

- Charger du code depuis un fichier de configuration ou depuis un dossier utilisateur : les jeux sont déclarés dans le code.
- Dépendre d'un service externe. Un jeu avec audio ou images fournit ses ressources dans son propre dossier, servies localement.
- Accéder au réseau, au système de fichiers ou aux autres salles.

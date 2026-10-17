# Prompt : créer « Gags en rafale » dans PartyHub

Ce document est un cahier des charges complet. Il permet de recréer le jeu à l'identique dans une copie de PartyHub,
ou de le faire écrire par un assistant de code. Il est servi par l'application elle-même (`/prompts/gags-en-rafale.md`),
donc disponible dans l'image Docker publiée.

## Le prompt à donner

> Dans le monorepo PartyHub (npm workspaces : `shared`, `games`, `server`, `web`), ajoute le jeu **Gags en rafale** :
> une succession de gags absurdes d'une seconde, seul ou à plusieurs, joués depuis le téléphone (la manette) et
> annoncés sur l'écran principal. Suis le contrat décrit ci-dessous, les règles exactes, les constantes, puis
> écris les tests et vérifie typage, lint, format, tests et build. Ne modifie pas le cœur (salles, connexions, scores).

## Contexte technique

- Un jeu est un module dans `packages/games/src/<id>/` : `module.ts` (moteur), `gags.ts` (règles pures),
  `client/` (vues : `HostScreen.tsx`, `PlayerScreen.tsx`, `phone-games.tsx`, `types.ts`).
- Le moteur implémente `GameModule` (`packages/shared/src/game-types.ts`) : `manifest`, `settingsSchema`,
  `defaultSettings`, `actions`, `initialize`, `onPlayerJoin`, `onPlayerLeave`, `start`, `handleAction`, `onTimer`,
  `nextRound`, `calculateScores`, `end`, `getPublicState`, `getPlayerState`, `getHostState`, `isFinished`, et `suggest`
  pour les robots du mode test. Le temps passe par `ctx.now()`, les minuteurs par `ctx.schedule(clé, ms)` et
  `ctx.cancel(clé)`, le hasard par `ctx.random()` (injecté : les tests sont déterministes).
- Helpers partagés : `packages/games/src/common/engine.ts` (`ok`, `fail`, `directory`, `shuffle`, `rankEntries`,
  `addPoints`, `everyConnectedDone`).
- Enregistrement, deux registres : `packages/games/src/index.ts` (ajouter le module à `gameRegistry` et l'exporter) et
  `packages/games/src/client/index.tsx` (entrée `clientViews` avec `lazyViews`, et `fieldSettings` pour le réglage).
- Identité visuelle : une entrée dans `packages/web/src/components/gameLogos.ts` (titre et couleurs), et un décor
  dans `packages/web/src/components/GameScene.tsx`. Les styles vont dans `packages/web/src/styles.css`, préfixe `gag-`.
- Les vues reçoivent `publicState`, `playerState`, `hostState` et `send(type, payload)` (voir
  `packages/games/src/client/types.ts`). Le navigateur ne reçoit jamais la réponse attendue avant le bilan.

## Réglage et déroulement

- Réglage : `rounds`, entier de 1 à 20, 10 par défaut (champ « Gags » dans le salon).
- Joueurs : de 1 à 12. Seul est permis : un joueur suffit à clore chaque gag.
- Phases : `ready` → (`intro` → `play` → `reveal`) × nombre de gags → `final`.
  - Présentation (`intro`) : 2 200 ms. Le gag s'affiche sur l'écran principal, avec sa phrase absurde.
  - Gag (`play`) : durée propre à chaque gag. Il finit plus tôt quand tous les joueurs connectés ont répondu.
  - Bilan (`reveal`) : 3 000 ms. Une réplique du gag (réussite ou raté), puis le classement.
- Ordre des gags : un sac à remplir et vider, sans jamais deux fois le même gag de suite (`buildSequence`).
- Chaque gag reçoit une graine entière, tirée à la partie : elle sert à la mouche et reste publique (la mouche est
  visible de tous).

## Les six gags

| Gag (id) | Geste sur le téléphone | Durée | Réussite | Réponse gagnante (robots) | Réponse perdante (robots) |
|---|---|---|---|---|---|
| Lance la crêpe (`crepe`) | glisser vers le haut sur un tiers de l'aire | 5 000 ms | `value` ≥ 180 ms, ≤ durée, ≤ temps écoulé + 400 | 700 | 0 |
| Écrase la mouche (`mouche`) | taper la mouche qui bouge ; un raté ne compte pas, on retente | 6 000 ms | le point touché est à ≤ 0,11 de la mouche à l'instant `value` | `value` 800, au centre de la mouche | (0, 0) à 800 |
| Gonfle le ballon (`ballon`) | maintenir puis relâcher | 4 500 ms | maintien `value` entre 900 et 1 500 ms, ≤ temps écoulé + 400 | 1 000 | 300 |
| Surtout, ne touchez pas (`patience`) | ne rien toucher ; un tap perd | 4 000 ms | toute réponse perd. Qui n'envoie rien à la fin gagne (`silentOutcome`) | aucune réponse | tap à 200 |
| Faites la statue (`statue`) | rester immobile (capteur de mouvement) | 5 000 ms | immobile ≥ 1 500 ms, ≤ temps écoulé + 400 | 1 500 | 0 |
| Gratte le ticket (`gratte`) | gratter 70 % du ticket | 6 000 ms | `value` ≥ 600 ms, ≤ durée, ≤ temps écoulé + 400 | 900 | 0 |

Règles communes :
- Le serveur ne croit jamais un résultat impossible dans le temps écoulé : `value` ≤ temps écoulé + 400 ms (tolérance réseau).
- Points : 100 pour une réussite, plus jusqu'à 60 selon la rapidité : `100 + round(60 × max(0, 1 − temps / durée))`.
- Un joueur qui n'envoie rien rate, sauf au gag « Surtout, ne touchez pas », où il réussit s'il est toujours connecté
  (un joueur parti ne gagne rien à ne rien faire).
- Les robots du mode test réussissent six fois sur dix, avec leur réponse gagnante, au plus tôt 0,7 s après le début
  (délai minimal de leur action). La statue ne leur est donc accessible qu'après 1,1 s : c'est normal.

Constantes (dans `gags.ts`, à reprendre telles quelles) : `LATENCY_SLACK_MS = 400`, `CREPE_SWIPE_RATIO = 0.33`,
`CREPE_MIN_MS = 180`, `FLY_RADIUS = 0.11`, `BALLOON_MIN_MS = 900`, `BALLOON_MAX_MS = 1500`, `STATUE_MS = 1500`,
`STILL_ACCEL = 0.5` (m/s², sans la pesanteur), `SCRATCH_MIN_MS = 600`, `SCRATCH_SHARE = 0.7`,
`SUCCESS_POINTS = 100`, `SPEED_BONUS = 60`.

Mouche : la position à l'instant `t` (ms) est une courbe de Lissajous, identique sur tous les écrans :
`x = 0,5 + 0,3 × sin(t/600 + a)`, `y = 0,5 + 0,24 × sin(t/420 + b)`, où `a` et `b` viennent de la graine
(`frac(seed × 0,618034) × 2π` et `frac(seed × 0,414214) × 2π`). Le téléphone et le serveur utilisent la même fonction.

## Écrans

- **Écran principal** : présentation (icône, nom, phrase absurde, consigne, précision, compte à rebours) ; en jeu,
  la consigne, la barre de temps, la scène (la mouche suit sa trajectoire ; les autres gags montrent une icône
  animée), la liste des joueurs avec ✔ prêt (ou ✘ touché pour l'attente) ; bilan (réplique du gag, résultats,
  classement) ; fin (classement final).
- **Téléphone** : présentation avec la phrase absurde ; défi du gag ; « Envoyé ! » après une réponse (« Touché ! »
  pour l'attente) ; bilan (Réussi / Raté / Pas de réponse, réplique du gag, points gagnés, total).
  Retours pendant le défi : la crêpe montre la progression du glissement ; le ballon indique « Encore un peu… »,
  « À point ! Relâchez » ou « Trop tard » ; la mouche signale un tap raté et laisse retenter.
  Le gag « Faites la statue » demande l'autorisation du mouvement (iOS). Sans capteur, ou hors HTTPS,
  il affiche un message qui dit pourquoi.
- Le téléphone mesure le temps depuis le début du gag avec `useLocalStart` (horloge recalée sur le serveur).

## Tests attendus

- Règles : chaque gag réussit et échoue comme décrit ; la mouche refuse un tap à côté ou au mauvais moment ; la
  suite ne répète jamais un gag ; les robots gagnent avec leur réponse gagnante au délai minimal.
- Déroulement : solo et à deux ; réponse unique par joueur ; bilan anticipé quand tous ont répondu ; le « ne touchez
  pas » se gagne par le silence ; aucune réponse attendue n'apparaît dans la vue publique ; pas d'arrivée en cours de jeu.
- Vues : rendu de chaque gag à chaque phase, côté écran principal et téléphone, sans `NaN` ni `undefined`.
- Registres : `registry.test.ts` et `settings-ui-coverage.test.ts` restent verts ; les logos et décors ont une entrée.

## Vérifications avant de livrer

`npm run typecheck`, `npm run lint` (zéro erreur), `npm run format:check`, `npm test`, `npm run build`. Puis un essai
réel : une salle, un téléphone qui joue les gags avec de vrais gestes, et l'écran principal qui suit la partie.

## Docker

L'image se construit depuis le dépôt (`Dockerfile`, étape de compilation) : le jeu et ce prompt (dans
`packages/web/public/prompts/`, copié dans `packages/web/dist`) y sont inclus. Une nouvelle version publiée
(tag `v*`, workflow `release.yml`) est nécessaire pour que l'image officielle contienne le jeu. En local :
`docker compose -f compose.dev.yaml up -d --build`.

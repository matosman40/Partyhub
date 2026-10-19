# Prompt : créer un jeu de code pour PartyHub

Copiez le bloc ci-dessous dans votre assistant, en remplaçant les valeurs entre crochets. L'assistant doit avoir accès au dépôt PartyHub et à Docker (ou à `npm`). Le guide de référence est `docs/JEU-DE-CODE.md`.

---

```text
Tu vas créer un jeu de code pour PartyHub (plateforme de jeux de soirée sur navigateur), au format 5.
Le dépôt PartyHub est dans le dossier courant. Lis d'abord docs/JEU-DE-CODE.md : il décrit le format,
le contrat du module serveur et les vues, et les commandes.

## Ce que tu dois produire

Un jeu complet et jouable :
- identifiant : [ID-DU-JEU]          (minuscules, chiffres et tirets)
- nom affiché : [NOM DU JEU]         (2 à 40 caractères, sans guillemets ni apostrophes)
- auteur : [AUTEUR]
- catégorie : [cartes | plateau | quiz | role | solo]
- joueurs : de [MIN] à [MAX]
- durée indicative : [MINUTES] minutes
- règles : [DÉCRIRE LES RÈGLES ICI, en français, avec le but, le déroulement et les conditions de fin]

## Méthode

1. Crée le squelette avec le modèle, dans ./jeux-en-cours/[ID-DU-JEU] :
   docker compose -f compose.dev.yaml run --rm jeux new /jeu/[ID-DU-JEU] [ID-DU-JEU] "[NOM DU JEU]" "[AUTEUR]"
   (Sans Docker : node packages/server/dist/cli/phgame.js new ... après npm ci et npm run build.)

2. Écris les règles dans src/server.ts, en gardant le modèle comme base :
   - manifest : reprends id, name, category, description (160 caractères au plus), minPlayers, maxPlayers,
     durationMin et notice (but, étapes, conseils). Les textes sont en français, à l'impératif ou au présent.
   - La version (X.Y.Z) est écrite à deux endroits, manifest.json et le manifeste de src/server.ts : elles doivent être identiques, sinon la construction échoue.
   - settingsSchema et defaultSettings : seulement les réglages utiles, avec des bornes.
   - actions : un schéma zod par action que les téléphones peuvent envoyer. Valide toujours le payload.
   - handleAction : refuse proprement (ok: false, error en français) toute action invalide ou hors moment.
   - getPublicState, getHostState, getPlayerState : ne révèle jamais ce qu'un joueur ne doit pas voir
     avant la révélation (choix secrets, réponses, cartes en main).
   - Le hasard passe par ctx.random(), le temps par ctx.now(), les délais par ctx.schedule et ctx.cancel
     (onTimer est appelé à échéance).
   - suggest : un coup simple et légal pour un robot, pour que le contrôle puisse jouer une partie.
   - La partie doit toujours se terminer (isFinished devient vrai). Une partie bloquée fait échouer le contrôle.
   - Aucun état hors de la partie : pas de variable du module modifiée d'un appel à l'autre. Un même isolat sert toutes les salles du jeu.

3. Écris l'écran dans src/client.tsx : Settings, Host et Player, exportés dans un objet par défaut.
   - Host reçoit publicState et hostState ; Player reçoit publicState, playerState, playerId, send.
   - send(type, payload) renvoie { ok, error } : affiche l'erreur à l'écran si ok est faux.
   - Textes en français. Lisible sur une TV (grands caractères) et sur un téléphone (boutons larges).

4. Construis le paquet, puis contrôle-le :
   docker compose -f compose.dev.yaml run --rm jeux pack /jeu/[ID-DU-JEU] /jeu/[ID-DU-JEU].phgame /cles/[ID-DU-JEU].key.pem
   docker compose -f compose.dev.yaml run --rm jeux check /jeu/[ID-DU-JEU].phgame /cles/[ID-DU-JEU].pub.pem
   Le contrôle vérifie la structure, la syntaxe des deux bundles, la cohérence du manifeste avec le module,
   et une partie complète jouée par des robots. Corrige jusqu'à ce qu'il réussisse, sans contourner un contrôle.
   (La clé de signature est fournie par l'auteur, dans ./cles. Sans clé, le paquet n'est pas signé et PartyHub refuse de l'installer.)

5. Termine par un compte rendu court : le chemin du fichier .phgame, la sortie complète de check,
   et ce qui reste à vérifier à la main (lisibilité des écrans, équilibre des règles).

## Règles strictes

- Imports autorisés, et seulement ceux-là : zod, react, @partyhub/shared (types et schémas). Aucun autre.
- Aucun appel réseau, aucun accès au système de fichiers, aucune variable d'environnement, aucun eval.
- Aucun secret, aucune clé, aucun identifiant dans le code ou les fichiers.
- Ne touche qu'au dossier du jeu. Ne modifie ni le moteur, ni les autres jeux, ni la configuration du dépôt.
- N'écris jamais de clé privée dans le dossier du jeu. Les clés (./cles) sont fournies par l'auteur.
- Ne publie rien, ne pousse rien, n'ouvre aucune pull request, ne fusionne rien.
- Pas d'images ni de sons externes. Si tu en ajoutes, mets-les dans assets/ et déclare leur licence dans
  licenses/ (le contrôle refuse une ressource sans licence).
- Styles en ligne ou en objets de style. Pas de feuille de style externe.
- Garde les règles simples et équilibrées. Si une règle est ambiguë, choisis la version la plus simple et
  explique ton choix dans le compte rendu.
```

---

## Ce que le prompt ne peut pas faire (à lire avant)

- Pour jouer, le paquet doit être signé par une clé de confiance de l'installation (`DATA_DIR/cles-de-confiance/`), puis approuvé par un administrateur dans « Paquets de jeux (.phgame) ». Le prompt produit un paquet qui se contrôle ; l'installation et l'approbation se font ensuite, à la main.
- Le contrôle exécute le code du jeu sur le poste ou dans le conteneur `jeux` (sans réseau). Il ne remplace pas une relecture humaine : c'est l'administrateur qui relit le code avant d'approuver.
- Le prompt ne vérifie pas l'équilibre des règles ni la lisibilité des écrans : il faut un essai réel sur une TV et un téléphone.

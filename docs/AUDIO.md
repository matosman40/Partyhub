# Sons de PartyHub

Ce document décrit les sons de l'application, leur origine, leur format et leur état. Il se tient à jour avec le code.

## 1. Sons en place dans l'application

Chaque bruitage a un fichier livré avec l'application, `packages/web/public/sons/bruitages/<nom>.mp3` (sons générés, voir section 3). L'administration peut le remplacer par un fichier de la médiathèque. Le son synthétisé de `packages/games/src/client/audio.ts` ne sert plus que pendant le chargement du fichier, ou si celui-ci est illisible.

| Nom (`SfxName`) | Usage               | Libellé             |
| --------------- | ------------------- | ------------------- |
| `place`         | pose d'une pièce    | Pose d'une pièce    |
| `explode`       | explosion           | Explosion           |
| `crate`         | caisse brisée       | Caisse brisée       |
| `pickup`        | ramassage           | Ramassage           |
| `die`           | élimination         | Élimination         |
| `hit`           | impact              | Impact              |
| `start`         | lancement de partie | Lancement de partie |
| `win`           | victoire            | Victoire            |
| `final`         | fin de partie       | Fin de partie       |
| `click`         | clic                | Clic                |
| `card`          | carte posée         | Carte posée         |
| `draw`          | pioche              | Pioche              |
| `turn`          | votre tour          | Votre tour          |
| `chip`          | jetons poussés      | Jetons poussés      |

La liste est définie dans `packages/shared/src/sounds.ts`. Elle est partagée par le serveur, le téléphone et la TV : tout ajout passe par un plan validé.

## 2. Musiques de partie

Chaque jeu intégré a sa musique, `packages/web/public/sons/musiques/<jeu>.mp3` (29 pistes, sans voix, contrôle Whisper). Elle tourne en boucle sur l'écran principal pendant la partie (`builtinGameMusic` dans `packages/web/src/sounds.ts`) ; Photo mystère et Tirage surprise empruntent celle de Quiz Party. Elle remplace la boucle synthétisée de Banquise et de Bombes Party. Le téléphone ne joue pas de musique de partie.

Les musiques de l'accueil, des menus et de la fin de partie restent à choisir dans l'administration. Le lot de 8 sons CC0 (Openverse) de `packages/web/public/sons/` reste disponible par `scripts/sons-activer.mjs`.

Sons générés non branchés, hors du dépôt (`C:partyhub-sonslivraison`) : `bonne-reponse`, `erreur`, `compte-a-rebours`, `essai-validation` (ils demandent de nouveaux noms de bruitage), et les boucles courtes.

## 3. Origine et licences

| Source                          | Usage                         | Conditions                                                                                                             |
| ------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Synthèse Web Audio (`audio.ts`) | bruitages en place            | code du projet                                                                                                         |
| ACE Music (API)                 | sons courts et fonds musicaux | conditions sur les sons générés non publiées : à vérifier avant le déploiement                                         |
| Pixabay (téléchargement manuel) | sons retenus, à venir         | licence Pixabay : usage commercial sans attribution, pas de revente en fichier isolé, pas de téléchargement automatisé |

Règle : aucun téléchargement automatisé depuis Pixabay. Les fichiers sont téléchargés à la main depuis un compte personnel.

## 4. Format de livraison

Cible pour les fichiers livrés avec l'application :

- MP3, mono, 44,1 kHz, 64 kb/s ;
- silences de début et de fin retirés (sous -50 dBFS) ;
- fondu de sortie d'au moins 0,3 s pour les sons courts ;
- volume normalisé par son ;
- sons en boucle : fin raccordée au début par fondu enchaîné.

État (2026-11-04) : conversion faite avec ffmpeg (paquet Python `imageio-ffmpeg`, installé sans droits administrateur). Les fichiers livrables sont dans `C:\partyhub-sons\livraison\` : `sons\` (18 bruitages et sons d'interface, silences retirés), `boucles\` (18 sons courts en boucle, raccord conservé), `musiques\` (29 fonds, raccord conservé). Poids total : 6,4 Mo.

## 5. Règles d'usage

- Un son par action : chaque action du joueur (bouton, réponse, tour, élimination) a son son, à l'échelle de son importance.
- Pas de sons enfantins ni de bips de dessin animé : le ton est sobre et adulte.
- Les sons fréquents (clics, pose de carte) restent discrets et limités en fréquence.
- Les sons importants (victoire, fin de partie) sont rares.
- La musique se coupe quand la page n'est pas visible, sauf sur l'écran principal qui doit la garder (décision à valider).
- Le son ne bloque jamais le démarrage : il s'active au premier geste de l'utilisateur (`unlockOnFirstGesture`).

## 6. Vérification

- Chaque nouveau son est écouté (ou décrit par la transcription Whisper) avant d'être branché.
- Une boucle est vérifiée : pas de clic ni de silence au raccord.
- Le volume est comparé aux sons existants dans un jeu, sur téléphone.

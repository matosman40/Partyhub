# API publiques

Ce document recense les API gratuites de la liste [public-apis/public-apis](https://github.com/public-apis/public-apis) étudiées pour PartyHub, ce qui est branché et ce qui est écarté. Vérifié le 2026-11-05.

## Règle

Les jeux ne dépendent d'aucune API pendant une partie : PartyHub tourne sur le réseau local, souvent sans Internet. Les API servent à **produire du contenu à l'avance** (scripts du dossier `scripts/`), relu puis versionné dans le dépôt.

Critères retenus : sans clé, en HTTPS, contenu en français, licence compatible avec une diffusion dans le dépôt.

## Branché

| API | Licence des données | Usage | Fichier |
|---|---|---|---|
| [Wikidata](https://query.wikidata.org/) (SPARQL) | CC0 | Quiz Party : capitales, symboles chimiques, peintres de tableaux célèbres | `scripts/questions-donnees-ouvertes.mjs` |
| [API Géo](https://geo.api.gouv.fr/) | Licence Ouverte 2.0 (Etalab) : citer la source | Quiz Party : préfectures et numéros des départements | idem |
| [Wikimedia Commons](https://commons.wikimedia.org/) (API MediaWiki, géosearch) | licence par fichier (CC BY, CC BY-SA, CC0, domaine public ; NC et ND refusés) | Photo mystère : photos géolocalisées de lieux célèbres | `scripts/photo-mystere-photos.mjs` (`scout` puis `build`) |

Les questions générées sont dans `packages/games/src/quiz-party/questions-ouvertes.fr.json` (identifiants `od-…`). Ne pas les modifier à la main : corriger le script et le relancer.

```bash
node --use-system-ca scripts/questions-donnees-ouvertes.mjs
```

`--use-system-ca` sert derrière un proxy d'entreprise qui présente son propre certificat. Ne jamais désactiver la vérification TLS à la place.

Garde-fous du script : tirage fixe (même résultat d'un lancement à l'autre si les données n'ont pas bougé), capitales contestées et tableaux à attribution disputée écartés, question rejetée si elle contient sa réponse, peintres limités aux personnes. Le test `packages/games/src/__tests__/quiz-questions.test.ts` vérifie le fichier.

Mention de source à reprendre dans les crédits de l'application : « Données : Wikidata (CC0) ; API Géo, geo.api.gouv.fr (Licence Ouverte 2.0, Etalab). »

## Photo mystère : photos et carte

Les 29 photos viennent de Wikimedia Commons, relues une à une sur planches de contrôle avant d'être épinglées dans le script. Elles sont dans `packages/web/public/photo-mystere/` (5,2 Mo) avec leur auteur, leur licence et leur source dans `packages/games/src/photo-mystere/photos.fr.json`. Le jeu ne fait aucun appel réseau pendant une partie. La carte est celle du jeu Boum (`packages/games/src/boum/geo/`, données Natural Earth, domaine public).

Licences : à vérifier à nouveau avant le déploiement final (voir la mémoire du projet sur les licences d'images). Les crédits affichés à la révélation reprennent auteur, licence et source de chaque photo.

## Retenu pour plus tard

| API | Licence | Idée | Point à régler |
|---|---|---|---|
| [Openverse](https://api.openverse.org/) (audio et images) | par fichier, filtre `license=cc0` possible | sons et images CC0 pour les jeux | non branché : écoute et choix manuels à prévoir ; garder le lien d'origine de chaque fichier dans `docs/AUDIO.md` |
| [JokeAPI](https://v2.jokeapi.dev/) (`lang=fr`, `safe-mode`) | non précisée pour les blagues | blagues en français | quelques dizaines de blagues seulement, licence floue : à ne pas embarquer sans réponse de l'auteur |
| [Art Institute of Chicago](https://api.artic.edu/docs/), [Metropolitan Museum](https://metmuseum.github.io/) | images CC0 pour les œuvres du domaine public | quiz en images (« qui a peint ce tableau ? ») | Quiz Party n'affiche pas encore d'image |
| [Flagcdn](https://flagcdn.com/) | drapeaux du domaine public | quiz des drapeaux | même limite : pas d'image dans le quiz |
| [Iconify](https://iconify.design/docs/api/) | licence propre à chaque jeu d'icônes | icônes SVG | vérifier la licence du jeu d'icônes choisi avant tout ajout |
| [DiceBear](https://www.dicebear.com/) | licence propre à chaque style | avatars générés | doublon avec les avatars existants |

## Écarté

| API | Raison |
|---|---|
| Open Trivia DB, The Trivia API | questions en anglais seulement |
| REST Countries | noms de capitales en anglais ; Wikidata donne les noms français |
| Freesound, Pixabay, Unsplash, Pexels | clé obligatoire ; pour Pixabay, téléchargement automatisé interdit (voir `docs/AUDIO.md`) |
| Blague.xyz | clé obligatoire |
| Deck of Cards | accès refusé (403) au moment du test ; les jeux de cartes ont déjà leur paquet |
| Pokéapi, Jikan et autres API d'œuvres sous droits | images et noms protégés (constat sur la nature des contenus, API non testées) |
| Random Lexicon, mots aléatoires | anglais ou espagnol seulement, ou bloqués par Cloudflare |
| Open Food Facts | fonctionne, mais aucun jeu actuel n'en a l'usage |

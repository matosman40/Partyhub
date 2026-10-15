# BOUM ! : sources et licences

- Textes des banques de contenu : écrits pour PartyHub (amorce), sous la licence du projet. Aucun texte
  d'un jeu commercial n'est repris.
- Sons : tous synthétisés avec la Web Audio API, sans fichier (`packages/games/src/client/audio.ts`).
- Icônes, logo et mise en page : dessinés pour le projet.
- Carte et centres des pays (« Où est-ce ? ») : `packages/games/src/boum/geo/countries-data.ts`, généré par
  `scripts/boum/generate-countries.mjs`. Tracés et centres tirés de `world-atlas` (version 2, jeux 110 m et 50 m),
  dérivés de Natural Earth (domaine public), licence ISC. Noms français tirés de `i18n-iso-countries` (MIT).
  Quatorze territoires rattachés à un autre pays dans ces jeux ont un centre saisi à la main, indiqué dans le script.
- Polices : aucune police tierce n'est embarquée par BOUM pour l'instant.

# Tirage surprise : proposition de jeu aléatoire

Statut : **proposition**, à valider avant tout code. Date : 2026-11-05.

## L'idée

Un jeu où chaque manche est tirée au sort dans des sources de données ouvertes. Une manche peut être une
estimation de chiffre, une image à identifier, un lieu à placer sur la carte, ou un livre à attribuer.
Les joueurs ne savent pas à l'avance quel type de manche, ni quelle source, va tomber. La partie reste
cohérente parce que tout le tirage se fait à partir d'un **thème unique choisi au départ**.

## Déroulé

1. **Réglages** : thème (choisi dans une liste ou libre, plus tard), nombre de manches, difficulté (le même
   curseur que le quiz et Photo mystère).
2. **Tirage** : au démarrage, le serveur tire les manches. Chacune prend une source et un mode compatibles
   avec le thème, au hasard. Pas deux fois la même entité dans une partie.
3. **Manches** : chaque joueur répond sur son téléphone, l'écran principal montre la question. La révélation
   donne la source (avec son crédit) et le score.
4. **Bilan** : classement, et le lien vers chaque source utilisée.

## Modes de manche

| Mode | Question | Source possible | Score |
|---|---|---|---|
| Estimer | « Quelle est la population de… ? » (un chiffre) | Wikidata | écart relatif, comme « Plus ou moins » |
| Identifier | « Qui a peint ce tableau ? » / « Quelle espèce est-ce ? » | Met Museum (CC0), iNaturalist (photo sous licence libre) | quatre choix, comme le quiz |
| Localiser | « Où se trouve… ? » | Wikidata (coordonnées), Wikimedia Commons | distance, comme Photo mystère |
| Attribuer | « Qui a écrit ce livre ? » | Open Library | quatre choix |
| Chronologie | « Lequel est plus ancien ? » | Wikidata (dates) | deux choix |

## Cohérence

- Le **thème** est un filtre sur les sources : « Animaux » n'ouvre que iNaturalist et Wikidata « espèce ».
- Chaque entité tirée garde son **lien** vers la source : rien n'est inventé par l'IA sans vérification.
- Les **distracteurs** (mauvaises réponses) viennent de la même catégorie que la bonne réponse, pour rester
  plausibles.
- Une partie porte une **graine** : les manches sont reproductibles, utile pour les tests et pour rejouer.

## APIs utilisables (vérifiées le 2026-11-05)

| API | Usage | Clé | Licence des données | Limite connue |
|---|---|---|---|---|
| Wikidata (SPARQL) | faits, coordonnées, dates | non | CC0 | requêtes lentes, 502 possibles |
| Met Museum (v1 objets, v1.1 recherche) | tableaux | non | CC0 | débit limité, 403 en rafale |
| iNaturalist | espèces, noms français, photos | non | licence par photo | à filtrer (CC) |
| Open Library | livres et auteurs | non | données libres | à vérifier |
| Nobel Prize | lauréats | non | données libres | liste fermée |
| API Géo | communes, départements | non | Licence Ouverte | — |
| Wikimedia Commons | photos géolocalisées | non | licence par fichier | relecture obligatoire |
| Flagcdn | drapeaux | non | à vérifier (non confirmée) | ne pas utiliser avant vérification |

Tout est **préparé à l'avance** : un script récupère les entités, vérifie la licence, et écrit une banque
locale. Le jeu ne tire que dans cette banque. C'est la même méthode que Quiz Party et Photo mystère, et elle
respecte la règle « pas de service externe pendant la partie ».

## Option : thèmes libres et IA

Une fois la banque en place, un thème libre peut être résolu dans Wikidata puis complété par la génération IA
(voir la proposition du précédent message). Cela se fait dans un job, avec secours sur la banque locale.

## Ce qui reste à décider

1. Le nom du jeu (« Tirage surprise » est un nom de travail).
2. Les modes à garder pour la première version : je propose **Estimer, Identifier, Localiser**.
3. Le nombre de thèmes au lancement : je propose **cinq** (Animaux, Monuments, Peintures, Pays, Sciences).

## Étapes et temps estimé

| Étape | Temps |
|---|---|
| Script de banque (Wikidata, Met, iNaturalist) + relecture de licences | 1 jour |
| Module serveur : tirage, graine, phases, scores | 1 jour |
| Vues TV et téléphone, réglages, thème | 1 jour |
| Tests et vérification navigateur | 0,5 jour |
| Thèmes libres avec IA (plus tard) | 2 jours |

Total pour la première version : environ **3,5 jours** de travail.

## Avancement (2026-11-05)

Décisions retenues par défaut (à confirmer) : nom « Tirage surprise », modes Estimer, Identifier, Localiser, cinq thèmes.

- **Fait** : banque du mode Estimer, `packages/games/src/tirage/banque-estimer.fr.json` (117 entrées : 60 populations de pays, 57 altitudes de montagnes, Wikidata CC0). Générée par `scripts/tirage-banque.mjs`. Altitudes limitées à l'Everest pour écarter les unités erronées de Wikidata ; doublons retirés.
- **Reste** : le module du jeu (règles, phases, score à écart relatif), les vues, la banque du mode Identifier (Met et iNaturalist), et les tests.

- **Fait (16 h 40)** : module serveur du mode Estimer (`packages/games/src/tirage/module.ts`) : tirage sans répétition, points selon l'écart et le niveau, confidentialité des estimations. 10 tests. **Non enregistré** dans le catalogue : il faut d'abord les vues.

- **Correction (16 h 35)** : les altitudes de montagnes sont désactivées. Un essai réel a révélé une erreur de Wikidata (« El Capitan » à 8 064 m, entité homonyme). La banque ne contient que les populations (59 pays). Les altitudes reviendront après vérification manuelle des entités.
- **Jeu enregistré et jouable** en mode Estimer (vues, logo, décor). Essai réel : une manche complète, avec estimations des robots et révélation.

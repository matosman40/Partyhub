# Contribuer à PartyHub

Merci de votre intérêt. PartyHub est un jeu de soirée sur navigateur, déployé avec Docker Compose ou CasaOS.

## Avant de commencer

- Ouvrez une issue pour un bug ou une fonctionnalité avant un gros changement, pour vérifier que l'idée convient.
- Les agents (Claude Code ou autre) suivent les consignes de `CLAUDE.md`, à la racine du dépôt.
- Une fonctionnalité qui touche aux données (base, paquets, sauvegardes) doit dire comment les données existantes
  sont migrées. Voir `packages/server/src/db/store.ts` : une migration ne se modifie jamais une fois publiée.

## Mise en place

```bash
npm ci
npm run build
npm run lint
npm run format:check
npm run typecheck
npm test
```

`npm run lint` vérifie le code avec ESLint (configuration `eslint.config.js`). Les erreurs bloquent ; les
avertissements, comme les `any` restants, sont à réduire mais ne bloquent pas. `npm run format:check` vérifie la
mise en forme avec Prettier (`npm run format` la corrige). La CI (`.github/workflows/ci.yml`) lance ces contrôles sur
chaque pull request, et un contrôle des secrets (`python3 scripts/secret-scan.py`) cherche une clé, un jeton ou un
mot de passe dans les fichiers suivis.

Pour tester le déploiement sur votre machine : `docker compose -f compose.dev.yaml up -d --build`.
Pour un utilisateur final, `compose.yaml` utilise l'image publiée et ne compile rien.

## Règles du code

- TypeScript strict. Les règles de jeu restent dans les modules de jeu, sans dépendance au réseau.
- Les textes affichés sont en français, avec les accents et l'apostrophe typographique (’) comme dans le reste du projet.
- Chaque correction de bug ajoute un test qui échoue sans elle.
- Les variables d'environnement se documentent dans `.env.example` ; `compose.yaml` et `compose.dev.yaml` doivent les
  transmettre. Un test de cohérence le vérifie.
- Pas de secret, de jeton ou de mot de passe dans le code, les tests ou les commits.

## Pull requests

Une pull request décrit :
- son objectif, en une ou deux phrases ;
- les tests ajoutés ou modifiés, et le résultat de `npm test` ;
- son impact sur Docker, CasaOS ou la configuration, s'il y en a ;
- son impact sur les données existantes, s'il y en a ;
- une capture d'écran pour tout changement d'interface.

Les pull requests se relisent avant fusion. Une version ne se publie que par un tag `vX.Y.Z` validé, jamais à partir
d'une pull request.

## Licence

En contribuant, vous acceptez que votre contribution soit publiée sous la licence MIT du projet (fichier `LICENSE`).

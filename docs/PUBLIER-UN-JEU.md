# Publier un jeu depuis son dépôt GitHub

Chaque jeu vit dans son propre dépôt. Une release GitHub contient le paquet `.phgame` et son empreinte ; PartyHub
l'installe et le met à jour depuis la section **Sources GitHub** de l'administration (voir [PHGAME.md](PHGAME.md)).

## Ce qu'il faut dans le dépôt du jeu

```
mon-jeu/
├── manifest.json
├── game/definition.json
└── licenses/LICENCE.txt
```

Le numéro de version du tag doit être égal à `version` dans `manifest.json` (par exemple le tag `v1.2.0` pour `"version": "1.2.0"`).

## Workflow de publication (modèle, à copier dans `.github/workflows/publier.yml`)

Ce modèle n'a pas encore été exécuté sur GitHub : testez-le sur un dépôt de test avant de l'utiliser.

```yaml
name: Publier le paquet
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  publier:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          path: mon-jeu
      - uses: actions/checkout@v4
        with:
          repository: matosman40/Partyhub
          ref: v0.6.3
          path: partyhub
      - name: Préparer PartyHub
        working-directory: partyhub
        run: |
          npm ci --ignore-scripts
          npm run build -w @partyhub/shared
          npm run build -w @partyhub/games
          npm run build -w @partyhub/server
      - name: Construire et vérifier le paquet
        working-directory: partyhub
        run: |
          npm run phgame -w @partyhub/server -- pack "$GITHUB_WORKSPACE/mon-jeu/" "$GITHUB_WORKSPACE/mon-jeu.phgame"
          npm run phgame -w @partyhub/server -- check "$GITHUB_WORKSPACE/mon-jeu.phgame"
      - name: Empreinte
        run: sha256sum mon-jeu.phgame > mon-jeu.phgame.sha256
      - name: Publier la release
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release create "$GITHUB_REF_NAME" mon-jeu.phgame mon-jeu.phgame.sha256 --generate-notes
```

Notes :
- Le modèle utilise la version 0.6.3 de PartyHub pour construire et vérifier le paquet. Mettez à jour `ref` quand le moteur change.
- Le fichier `mon-jeu.phgame.sha256` est obligatoire : sans lui, PartyHub refuse la release.
- Pour un dépôt privé, PartyHub a besoin d'un jeton GitHub (variable `GITHUB_TOKEN` du serveur) pouvant lire les releases.

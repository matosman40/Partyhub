# Magasin de jeux

Le magasin liste les jeux publiés dans un dépôt GitHub de jeux, et permet de les installer, de les mettre à jour et de
les supprimer depuis l'administration : carte **Jeux**, section **Magasin de jeux** (les sources GitHub sont juste en dessous).

## Dépôt de jeux

- Le dépôt par défaut est `matosman40/jeux-partyhub`. Pour en utiliser un autre, réglez la variable
  `PARTYHUB_STORE_REPO` (auteur/nom), ou changez-le dans l'administration. Le réglage de l'administration l'emporte.
- Un jeu est un dossier `jeux/<jeu>/` avec son `manifest.json`. Chaque version est une release, dont le tag est
  `<jeu>-vX.Y.Z` (voir `docs/PUBLIER-UN-JEU.md`).
- Le magasin lit les tags : la version la plus haute de chaque jeu est proposée. Sa fiche (nom, description, auteur,
  type de jeu, couverture) est lue dans le manifeste à ce tag.
- Une couverture se trouve sous `assets/`, au format PNG, JPEG ou WebP, et pèse 200 Ko au plus. Un fichier qui n'a
  pas la signature de son format n'est jamais affiché.

## Installer, mettre à jour, supprimer

- **Installer** crée une source GitHub pour le jeu, avec mise à jour automatique, puis installe la dernière release.
  Les vérifications sont les mêmes que pour les sources GitHub : empreinte SHA-256, validation du paquet, identifiant
  et version. Un échec n'installe rien et ne laisse pas de source.
- **Mettre à jour** (ou **Vérifier**) interroge le dépôt tout de suite. Les jeux installés depuis le magasin se mettent
  aussi à jour une fois par jour.
- **Supprimer** retire le paquet, toutes ses versions, et sa source. Les parties en cours de ce jeu sont fermées.
- Un jeu intégré au code de PartyHub est listé comme *Intégré à l'application*. Il ne se télécharge pas, et reste
  disponible hors ligne.

## Jeux de code

- Un jeu de code se publie comme les autres : `jeux/<jeu>/manifest.json` avec `"kind": "code"` (sans `requires`), et une
  release `<jeu>-vX.Y.Z` qui contient le `<jeu>.phgame` signé et son `.sha256`.
- Le paquet doit être signé par une clé présente dans `DATA_DIR/cles-de-confiance/`. Sans elle, l'installation est
  refusée (« Paquet refusé »). Ajoutez la clé de l'auteur avant d'installer.
- **Installer** met la version en attente : le magasin affiche « En attente de revue ». L'approbation se fait dans
  **Jeux de code**, après relecture du code, comme pour un jeu ajouté par une autre voie.
- La mise à jour quotidienne ne remplace jamais la version active. La nouvelle version attend la revue, et l'ancienne
  continue à tourner.
- **Supprimer** retire toutes les versions du jeu, en attente ou approuvées, ferme ses salons et supprime la source.
  Un jeu retiré depuis **Jeux de code** se réinstalle avec **Installer**.

## Limites

- Un jeu de code (format 5) s'installe par le magasin, mais jamais seul : il reste en attente de revue, et un
  administrateur l'approuve dans **Jeux de code** avant qu'il ne s'exécute (voir la section suivante).
- Les images d'un paquet (dossier `assets/`) sont vérifiées et installées, mais aucun jeu ne les affiche encore.
- Le magasin lit des dépôts publics. Un dépôt privé passe par une source GitHub (`GITHUB_TOKEN` requis).
- Sans `GITHUB_TOKEN`, GitHub limite les appels à 60 par heure. Le catalogue est gardé dix minutes. Une erreur n'est
  jamais gardée : elle est relue au chargement suivant.

## Routes d'administration

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/admin/store` (`?refresh=1` pour ignorer le cache) | Catalogue et état de chaque jeu |
| PUT | `/api/admin/store/repo` | Changer de dépôt (`{ "repo": "auteur/nom" }`) |
| POST | `/api/admin/store/games/:id/install` | Installer un jeu |
| POST | `/api/admin/store/games/:id/update` | Vérifier et mettre à jour un jeu installé |
| DELETE | `/api/admin/store/games/:id` | Supprimer un jeu installé depuis le magasin |
| GET | `/api/admin/store/games/:id/cover` | Couverture d'un jeu |

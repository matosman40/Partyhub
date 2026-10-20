# Magasin de jeux

Le magasin liste les jeux publiés dans un dépôt GitHub de jeux. Il est accessible à tous depuis l'accueil (menu,
« Magasin de jeux », adresse `/magasin`). Installer, mettre à jour et supprimer un jeu demandent la session
administrateur ; sans elle, la page explique comment se connecter.

## Dépôt de jeux

- Le dépôt par défaut est `matosman40/jeux-partyhub`. Pour en utiliser un autre, réglez la variable
  `PARTYHUB_STORE_REPO` (auteur/nom), ou changez-le dans l'administration. Le réglage de l'administration l'emporte.
- Un jeu est un dossier `jeux/<jeu>/` avec son `manifest.json`. Chaque version est une release, dont le tag est
  `<jeu>-vX.Y.Z` (voir `docs/PUBLIER-UN-JEU.md`).
- Le magasin lit les tags : la version la plus haute de chaque jeu est proposée. Sa fiche (nom, description, auteur,
  type de jeu, couverture) est lue dans le manifeste à ce tag.
- Une couverture se trouve sous `assets/`, au format PNG, JPEG ou WebP, et pèse 200 Ko au plus. Un fichier qui n'a
  pas la signature de son format n'est jamais affiché.

## Catalogue et actualisation

- Le catalogue est gardé sur le serveur, dans `DATA_DIR/store/catalog.json`, avec les couvertures dans
  `DATA_DIR/store/covers/`. L'affichage lit ce fichier et n'appelle jamais GitHub.
- GitHub est interrogé **une fois par jour**, au plus. La liste des tags se lit avec une étiquette de version : si rien
  n'a changé, GitHub répond « inchangé », et cet appel ne compte pas dans la limite.
- Les fiches (manifestes) et couvertures ne sont lues qu'à leur première apparition, puis gardées. Elles passent par
  les fichiers bruts du dépôt, hors de l'API.
- La taille du paquet (`<jeu>.phgame`) est lue dans la release, une fois, pour chaque nouvelle version.
- Le bouton **Actualiser le catalogue** (administrateur) force une lecture, au plus une fois par heure.
- Si GitHub limite les appels, l'instantané reste affiché, avec l'heure de la prochaine tentative.

## Parcourir le magasin

- La recherche porte sur le nom, l'auteur, le type et la description du jeu, sans tenir compte des majuscules.
- Les filtres « À installer », « Installés », « Mises à jour » et « En revue » restreignent la liste à un état.
- Les étiquettes de type restreignent la liste au type choisi. Le tri se fait par état (mises à jour d'abord) ou par nom.
- Le jeu « À la une » est le premier jeu téléchargeable qui a une couverture. Il n'apparaît que sans filtre ni recherche.
- Cliquer sur une carte (ou « Voir la fiche ») ouvre la fiche du jeu : couverture, auteur, type, versions, taille du
  paquet, description complète.

## Installer, mettre à jour, supprimer

- **Installer** crée une source GitHub pour le jeu, avec mise à jour automatique, puis installe la dernière release.
  Les vérifications sont les mêmes que pour les sources GitHub : empreinte SHA-256, validation du paquet, identifiant
  et version. Un échec n'installe rien et ne laisse pas de source.
- **Mettre à jour** (ou **Vérifier**) interroge le dépôt tout de suite. Les jeux installés depuis le magasin se mettent
  aussi à jour à chaque lecture automatique du catalogue (une fois par jour).
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
- Sans `GITHUB_TOKEN`, GitHub limite les appels à 60 par heure. Avec un jeton (`GITHUB_TOKEN` dans `.env`, sans droit
  particulier pour un dépôt public), la limite est de 5000 par heure. Dans les deux cas, le catalogue reste lisible
  hors ligne grâce à l'instantané.
- Une erreur réseau est relue une heure plus tard ; une limite atteinte attend l'heure de reprise indiquée par GitHub.

## Routes

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| GET | `/api/store` | Public | Catalogue, état de chaque jeu, dates de lecture |
| GET | `/api/store/games/:id/cover` | Public | Couverture d'un jeu |
| POST | `/api/admin/store/refresh` | Administrateur | Actualiser le catalogue (une fois par heure au plus) |
| PUT | `/api/admin/store/repo` | Administrateur | Changer de dépôt (`{ "repo": "auteur/nom" }`) |
| POST | `/api/admin/store/games/:id/install` | Administrateur | Installer un jeu |
| POST | `/api/admin/store/games/:id/update` | Administrateur | Vérifier et mettre à jour un jeu installé |
| DELETE | `/api/admin/store/games/:id` | Administrateur | Supprimer un jeu installé depuis le magasin |

# Magasin de jeux

Le magasin liste les jeux publiés dans un dépôt GitHub de jeux, et permet de les installer, de les mettre à jour et de
les supprimer depuis l'administration, dans la section **Magasin de jeux**.

## Dépôt de jeux

- Le dépôt par défaut est `matosman40/jeux-partyhub`. Pour en utiliser un autre, réglez la variable
  `PARTYHUB_STORE_REPO` (auteur/nom), ou changez-le dans l'administration. Le réglage de l'administration l'emporte.
- Un jeu est un dossier `jeux/<jeu>/` avec son `manifest.json`. Chaque version est un tag `<jeu>-vX.Y.Z` du dépôt.
  Le dossier du jeu, tel qu'il est à ce tag, contient le jeu : `manifest.json`, `game/`, `assets/` et `licenses/` pour
  un jeu déclaratif (cartes, plateau, questions, recettes), `manifest.json`, `src/`, `assets/` et `licenses/` pour un
  jeu de code. Rien d'autre ne compte : les fichiers hors de `jeux/<jeu>/` ne font pas partie du paquet.
- Aucune release, aucun fichier `.phgame` et aucune signature ne sont nécessaires : PartyHub construit le paquet à
  partir du dossier, avec les mêmes contrôles que `phgame pack`.
- Le magasin lit les tags : la version la plus haute de chaque jeu est proposée. Sa fiche (nom, description, auteur,
  type de jeu, couverture) est lue dans le manifeste à ce tag.
- Une couverture se trouve sous `assets/`, au format PNG, JPEG ou WebP, et pèse 200 Ko au plus. Un fichier qui n'a
  pas la signature de son format n'est jamais affiché.

## Installer, mettre à jour, supprimer

- **Installer** crée une source du magasin pour le jeu, avec mise à jour automatique, puis construit le paquet à partir
  du dossier du jeu au tag le plus haut. Le dépôt est lu à ce tag, par son archive : chaque fichier du dossier doit
  correspondre à l'arbre du commit (une modification en route, ou un fichier en trop, est refusé). Le paquet passe
  ensuite la validation : identifiant, version, contenu. Un échec n'installe rien et ne laisse pas de source.
- **Mettre à jour** (ou **Vérifier**) interroge le dépôt tout de suite, et installe la version la plus haute si elle est
  plus récente.
  Les jeux installés depuis le magasin se mettent aussi à jour une fois par jour.
- **Supprimer** retire le paquet, toutes ses versions, et sa source. Les parties en cours de ce jeu sont fermées.
- Un jeu intégré au code de PartyHub est listé comme *Intégré à l'application*. Il ne se télécharge pas, et reste
  disponible hors ligne.

## Jeux de code

- Un jeu de code se publie comme les autres : `jeux/<jeu>/manifest.json` avec `"kind": "code"` (sans `requires`), et son
  code dans `src/` (`server.ts` et `client.tsx`), au tag `<jeu>-vX.Y.Z`. Le modèle de `phgame new` a cette forme.
- **Pas de signature** : PartyHub compile le jeu lui-même et ne lui demande aucune clé. Le manifeste ne doit pas porter
  de champ `signature` (refusé). Les clés de `DATA_DIR/cles-de-confiance/` ne servent qu'aux paquets déposés par une
  autre voie.
- **Installer** met la version en attente : le magasin affiche « En attente de revue ». L'approbation se fait dans
  **Jeux de code**, après relecture du code, comme pour un jeu ajouté par une autre voie. Rien ne s'exécute avant.
- La mise à jour quotidienne ne remplace jamais la version active. La nouvelle version attend la revue, et l'ancienne
  continue à tourner. Une version approuvée reste active après un redémarrage.
- **Supprimer** retire toutes les versions du jeu, en attente ou approuvées, ferme ses salons et supprime la source.
  Un jeu retiré depuis **Jeux de code** se réinstalle avec **Installer**.

## Limites

- Un jeu de code (format 5) s'installe par le magasin, mais jamais seul : il reste en attente de revue, et un
  administrateur l'approuve dans **Jeux de code** avant qu'il ne s'exécute (voir la section précédente).
- Les images d'un paquet (dossier `assets/`) sont vérifiées et installées, mais aucun jeu ne les affiche encore.
- Les jeux intégrés à l'application ne sont pas dans `jeux/` du dépôt : leurs fiches sont dans `jeux-integres/`, à
  titre d'information. Ils restent dans l'application et s'activent dans l'administration.
- Un dépôt privé demande `GITHUB_TOKEN`.
- Sans `GITHUB_TOKEN`, GitHub limite les appels à 60 par heure. Un jeu coûte quatre appels à l'API (version, commit,
  arbre, archive), à chaque construction, quel que soit le nombre de fichiers. L'archive contient tout le dépôt : elle
  grandit avec les musiques et les images. Limites : 128 Mio compressés, 256 Mio décompressés. Le catalogue est gardé
  dix minutes. Une erreur n'est jamais gardée : elle est relue au chargement suivant.

## Routes d'administration

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/admin/store` (`?refresh=1` pour ignorer le cache) | Catalogue et état de chaque jeu |
| PUT | `/api/admin/store/repo` | Changer de dépôt (`{ "repo": "auteur/nom" }`) |
| POST | `/api/admin/store/games/:id/install` | Installer un jeu |
| POST | `/api/admin/store/games/:id/update` | Vérifier et mettre à jour un jeu installé |
| DELETE | `/api/admin/store/games/:id` | Supprimer un jeu installé depuis le magasin |
| GET | `/api/admin/store/games/:id/cover` | Couverture d'un jeu |

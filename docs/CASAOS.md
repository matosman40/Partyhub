# Installation et mise à jour sur CasaOS

PartyHub s'installe comme une application Docker Compose. Le fichier `compose.yaml` du dépôt contient les métadonnées
`x-casaos` (nom, description, icône, port) que CasaOS affiche dans son tableau de bord.

L'image Docker est publiée sur GHCR : `ghcr.io/matosman40/partyhub:<version>`. Aucune compilation n'est nécessaire.

## 1. Prérequis

- CasaOS installé sur un serveur accessible sur le réseau local, avec accès au terminal (application Terminal, ou SSH).
- Le serveur doit pouvoir télécharger l'image depuis `ghcr.io`.
- Les ports indiqués dans `.env` doivent être libres (8282 par défaut).

## 2. Installation depuis le terminal (méthode recommandée)

Cette méthode fonctionne sur toute installation Docker Compose, CasaOS compris :

```bash
sudo mkdir -p /DATA/AppData && cd /DATA/AppData
sudo git clone https://github.com/matosman40/Partyhub.git partyhub
cd partyhub
sudo cp .env.example .env
sudo nano .env                     # ADMIN_PASSWORD, et PARTYHUB_PORT si besoin
sudo docker compose up -d
sudo docker compose ps             # doit afficher « healthy » après quelques secondes
```

## 3. Installation depuis l'interface CasaOS

1. Ouvrir la page du fichier `compose.yaml` sur GitHub, puis cliquer sur **Raw** et copier tout le contenu.
2. Dans CasaOS : **App Store → Install a customized app** (ou « Importer un compose » selon la version).
3. Coller le contenu copié, renseigner les variables (au minimum `ADMIN_PASSWORD`), puis valider.
4. Attendre que l'application passe à l'état « en cours d'exécution ».

Les données sont stockées dans le volume Docker `partyhub-data`. Ce volume est créé une seule fois et réutilisé
lors des installations et mises à jour suivantes.

## 4. Ouvrir le site depuis un téléphone

Sur le même Wi-Fi que le serveur :

- Écran principal (TV ou ordinateur) : `http://<adresse-du-serveur>:8282`
- Téléphones : scanner le QR code affiché sur l'écran, ou ouvrir `http://<adresse-du-serveur>:8282/join`

Trouver l'adresse du serveur : `hostname -I` sur le serveur, ou l'adresse affichée dans CasaOS.
Une adresse IP fixe (réservation DHCP sur le routeur) évite de devoir la retrouver.

## 5. Administration et mot de passe

Page : `http://<adresse-du-serveur>:8282/admin`.

- Mot de passe défini dans `.env` : il est appliqué à chaque démarrage. Pour le changer, modifier `ADMIN_PASSWORD`,
  puis relancer : `sudo docker compose up -d`.
- Mot de passe généré automatiquement : il est écrit dans le volume. Le lire puis le supprimer :

```bash
sudo docker compose exec partyhub cat /data/admin-password.txt
sudo docker compose exec partyhub rm /data/admin-password.txt
```

## 6. Mise à jour sans perdre les données

Chaque version fixe son image dans `compose.yaml`. Mettre à jour consiste donc à récupérer ce fichier, puis à
télécharger la nouvelle image :

```bash
cd /DATA/AppData/partyhub
sudo git fetch --tags
sudo git checkout vX.Y.Z      # la version voulue (liste : git tag -l 'v*')
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps
```

Le dépôt est sur un tag de version (« HEAD détaché »), donc un `git pull` seul ne suffit plus. Une fois le service
de mise à jour installé, la rubrique *Système* de l'administration propose les nouvelles versions avec leur changelog,
et s'en charge (voir [MISE-A-JOUR.md](MISE-A-JOUR.md)).

Depuis CasaOS : réimporter le nouveau `compose.yaml` (même procédure que la section 3), en gardant le même nom
d'application et les mêmes variables, afin de réutiliser le volume existant.

**Ne jamais exécuter `docker compose down -v`** : l'option `-v` supprime le volume, donc les données.

Consulter les notes de chaque version (`CHANGELOG.md`) avant une mise à jour : elles indiquent si une action manuelle est nécessaire.

Si la version modifie le schéma de la base, une copie est créée automatiquement dans le dossier `migrations` du volume
(`/data/migrations`) avant la mise à jour. Ne la supprimez pas tant que la nouvelle version n'est pas vérifiée. Si le démarrage
échoue avec un message « plus récente que cette version », réinstallez la version indiquée dans `compose.yaml` d'une version
supérieure, ou restaurez la copie correspondante (section 7).

## 7. Sauvegarde et restauration

Sauvegarde complète du volume (à faire avant une mise à jour importante) :

```bash
sudo docker run --rm -v partyhub-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/partyhub-data-$(date +%F).tar.gz -C /data .
```

Restauration : arrêter l'application (`sudo docker compose stop`), extraire l'archive dans le volume avec la même commande
en remplaçant `czf` par `xzf` et `-C /data .` par `-C /data`, puis relancer (`sudo docker compose up -d`).
Les sauvegardes automatiques de la base sont aussi dans le dossier `backups` du volume (voir le README).

## 8. Dépannage

| Symptôme                                                    | Cause probable                             | Action                                                                          |
| ----------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| Le site ne s'ouvre pas                                      | Port déjà utilisé                          | Changer `PARTYHUB_PORT` dans `.env`, puis `sudo docker compose up -d`           |
| `manifest unknown` ou `denied` au téléchargement de l'image | Version absente, ou paquet GHCR non public | Vérifier la version dans `compose.yaml` ; le paquet doit être public sur GitHub |
| « Connexion impossible »                                    | Conteneur arrêté ou non prêt               | `sudo docker compose logs`                                                      |
| Le QR code ouvre une mauvaise adresse                       | L'écran est ouvert avec `localhost`        | Ouvrir l'écran avec l'adresse IP du serveur                                     |
| Le conteneur est « unhealthy »                              | Serveur bloqué au démarrage                | Consulter les journaux, vérifier la place disque                                |

## 9. Désinstallation

```bash
sudo docker compose down              # arrête et supprime le conteneur, conserve le volume
sudo docker volume rm partyhub-data   # uniquement si vous voulez effacer les données
```

## 10. HTTPS sur CasaOS (micro et caméra sur les téléphones)

Le micro et la caméra des téléphones n'existent qu'en HTTPS. Le fichier `deploy/casaos/compose.https.yaml` contient
PartyHub **et** Caddy dans un seul fichier : il s'installe depuis l'interface CasaOS, sans ligne de commande.

1. Ouvrir le fichier sur GitHub, cliquer sur **Raw**, copier tout le contenu.
2. Dans CasaOS : **Install a customized app** (ou « Importer un compose »), coller le contenu.
3. Remplacer `192.168.1.156` par l'adresse fixe de votre serveur. Elle apparaît à deux endroits, dans la commande de
   Caddy : la ligne `default_sni` et le bloc `https://`. Renseigner `ADMIN_PASSWORD` si besoin, puis valider.
4. Ouvrir `https://<adresse-du-serveur>` sur le téléphone : passer l'avertissement (**Avancé**, **Continuer**).
5. Ouvrir **Installer le certificat HTTPS** dans le menu de l'accueil, télécharger le certificat, et suivre les étapes
   de l'appareil. Le détail est dans [HTTPS-LAN.md](HTTPS-LAN.md).

Le port d'accès devient **443** (`https://<adresse-du-serveur>`), et non plus 8282. Le port 443 doit être libre sur le
serveur. Les données restent dans le volume `partyhub-data` : le même que le compose de base.

La page `/certificat` est disponible à partir de la version 0.9.3 de l'image, dont le numéro est indiqué dans le fichier.
Le téléchargement du certificat ne dépend que de Caddy : il fonctionne dès que Caddy tourne.

Pour mettre à jour : réimporter le fichier de la version suivante, en gardant le même nom d'application et les mêmes
variables, comme dans la section 6.

## 11. Vérifier l'installation

Après l'installation (ou une mise à jour), sur le serveur :

```bash
sudo bash scripts/casaos-check.sh 192.168.1.156
```

Le script contrôle, sans rien modifier : les conteneurs, la réponse HTTPS, la page `/certificat`, le certificat racine
téléchargeable, la reconnaissance de ce certificat, et l'accès à l'administration. Chaque ligne est marquée OK ou ECHEC ;
le code de sortie vaut 1 en cas d'échec. Sans adresse, la première adresse IP de la machine est utilisée.

Pour les versions publiées, le fichier `deploy/casaos/compose.https.yaml` est testé avant chaque publication : mise à jour
depuis la version précédente (réglages et certificat conservés), puis installation propre, sur amd64 et arm64.

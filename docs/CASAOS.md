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
sudo git pull
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps
```

Depuis CasaOS : réimporter le nouveau `compose.yaml` (même procédure que la section 3), en gardant le même nom
d'application et les mêmes variables, afin de réutiliser le volume existant.

**Ne jamais exécuter `docker compose down -v`** : l'option `-v` supprime le volume, donc les données.

Consulter les notes de chaque version (`CHANGELOG.md`) avant une mise à jour : elles indiquent si une action manuelle est nécessaire.

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

| Symptôme | Cause probable | Action |
|---|---|---|
| Le site ne s'ouvre pas | Port déjà utilisé | Changer `PARTYHUB_PORT` dans `.env`, puis `sudo docker compose up -d` |
| `manifest unknown` ou `denied` au téléchargement de l'image | Version absente, ou paquet GHCR non public | Vérifier la version dans `compose.yaml` ; le paquet doit être public sur GitHub |
| « Connexion impossible » | Conteneur arrêté ou non prêt | `sudo docker compose logs` |
| Le QR code ouvre une mauvaise adresse | L'écran est ouvert avec `localhost` | Ouvrir l'écran avec l'adresse IP du serveur |
| Le conteneur est « unhealthy » | Serveur bloqué au démarrage | Consulter les journaux, vérifier la place disque |

## 9. Désinstallation

```bash
sudo docker compose down              # arrête et supprime le conteneur, conserve le volume
sudo docker volume rm partyhub-data   # uniquement si vous voulez effacer les données
```

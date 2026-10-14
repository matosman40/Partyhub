# Installation et mise à jour sur CasaOS

PartyHub s'installe comme une application Docker Compose. CasaOS lit les métadonnées `x-casaos`
du fichier `compose.yaml` pour l'afficher dans son tableau de bord.

## 1. Préparer le serveur

Prérequis : Ubuntu Server avec Docker et CasaOS. Le serveur doit être accessible sur le réseau local.

Copier le projet sur le serveur, par exemple dans `/DATA/AppData/partyhub` :

```bash
sudo mkdir -p /DATA/AppData && cd /DATA/AppData
# Option A : cloner le dépôt
sudo git clone https://github.com/matosman40/Partyhub.git partyhub
# Option B : copier le dossier puis se placer dedans
cd partyhub
```

Créer le fichier de configuration :

```bash
sudo cp .env.example .env
sudo nano .env
```

Renseigner au minimum `ADMIN_PASSWORD` (sinon un mot de passe aléatoire est écrit dans le volume,
voir section 5). Laisser `PARTYHUB_PORT=8282` sauf conflit avec une autre application.

## 2. Démarrer le conteneur

Depuis le terminal du serveur :

```bash
sudo docker compose up -d --build
sudo docker compose ps          # le service doit afficher « healthy » après quelques secondes
sudo docker compose logs -f     # Ctrl+C pour quitter les journaux
```

Depuis CasaOS : **App Store → Install a customized app** (ou « Importer un compose »), coller le contenu
de `compose.yaml` et renseigner les variables d'environnement, ou sélectionner le dossier du projet
si votre version de CasaOS le permet. L'application apparaît ensuite dans la liste des applications
et peut être démarrée, arrêtée et redémarrée depuis son interface.

Le conteneur redémarre automatiquement après un redémarrage du serveur (`restart: unless-stopped`).

## 3. Ouvrir le site depuis un téléphone

Sur le même Wi-Fi que le serveur :

- Écran principal (TV ou ordinateur) : `http://<adresse-du-serveur>:8282`
- Téléphones : scanner le QR code affiché sur l'écran, ou ouvrir `http://<adresse-du-serveur>:8282/join`

Trouver l'adresse du serveur : `hostname -I` sur le serveur, ou l'adresse affichée dans CasaOS.
Une adresse IP fixe (réservation DHCP sur le routeur) évite de devoir la retrouver.

## 4. Jouer une première partie

1. Sur l'écran principal, cliquer sur **Créer la salle** de Quiz Party.
2. Les joueurs scannent le QR code (ou entrent le code à 4 caractères).
3. Chaque joueur entre son pseudo puis touche **Je suis prêt !**.
4. Cliquer sur **Lancer la partie**.

## 5. Administration et mot de passe

Page : `http://<adresse-du-serveur>:8282/admin`.

- Mot de passe défini dans `.env` : il est appliqué à chaque démarrage. Pour le changer, modifier `ADMIN_PASSWORD`
  puis relancer : `sudo docker compose up -d`.
- Mot de passe généré automatiquement : il est écrit dans le volume. Le lire puis le supprimer :

```bash
sudo docker compose exec partyhub cat /data/admin-password.txt
sudo docker compose exec partyhub rm /data/admin-password.txt
```

## 6. Mise à jour sans perdre les données

Les données (réglages, jeux activés, statistiques) sont dans le volume Docker `partyhub-data`.
Une mise à jour reconstruit l'image et conserve ce volume.

```bash
cd /DATA/AppData/partyhub
sudo git pull                          # ou copier la nouvelle version du dossier, sans écraser .env
sudo docker compose up -d --build      # reconstruit l'image et relance le conteneur
sudo docker compose ps
```

Ne jamais exécuter `docker compose down -v` : l'option `-v` supprime le volume et donc les données.

Sauvegarder le volume avant une mise à jour importante :

```bash
sudo docker run --rm -v partyhub-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/partyhub-data-$(date +%F).tar.gz -C /data .
```

Restaurer une sauvegarde : arrêter le conteneur (`sudo docker compose stop`), puis extraire l'archive dans le volume
avec la même commande en inversant `czf`/`xzf`, et relancer.

## 7. Dépannage

| Symptôme | Cause probable | Action |
|---|---|---|
| Le site ne s'ouvre pas | Port déjà utilisé | Changer `PARTYHUB_PORT` dans `.env`, puis `up -d` |
| « Connexion impossible » | Conteneur arrêté ou non prêt | `sudo docker compose logs` |
| Le QR code ouvre une mauvaise adresse | Le navigateur de l'écran est ouvert avec `localhost` | Ouvrir l'écran avec l'adresse IP du serveur |
| Le conteneur est « unhealthy » | Serveur bloqué au démarrage | Consulter les journaux, vérifier la place disque |

## 8. Désinstallation

```bash
sudo docker compose down          # arrête et supprime le conteneur, conserve le volume
sudo docker volume rm partyhub-data   # uniquement si vous voulez effacer les données
```

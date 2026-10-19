# Mise à jour de PartyHub

Deux façons de mettre à jour, dans l'ordre de préférence :

1. **Depuis l'administration** : rubrique *Système*, bloc *Mise à jour*. La version en cours y est affichée, ainsi que le
   changelog de chaque version publiée. Cette méthode demande une installation unique du service de mise à jour
   (section 2).
2. **À la main**, dans un terminal sur le serveur (section 5). Toujours possible, même sans le service.

Les données (profils, statistiques, médiathèque) sont dans le volume Docker `partyhub-data` : elles ne sont jamais
supprimées par une mise à jour. Ne lancez jamais `docker compose down -v`.

## 1. Ce que fait une mise à jour depuis l'administration

1. L'administrateur choisit une version publiée plus récente que la version en cours, puis confirme.
2. L'application fait une copie de la base (`/data/backups`), puis enregistre la demande.
3. Pendant que la demande est en attente, **aucune nouvelle partie ne peut démarrer**. Si une partie est en cours,
   la mise à jour attend qu'elle se termine.
4. Le service sur l'hôte (qui vérifie chaque minute) bascule le dépôt sur le tag de la version, télécharge l'image,
   puis redémarre PartyHub. **Les salons ouverts sont fermés** : les joueurs doivent rejoindre une nouvelle partie.
5. Le serveur est considéré à jour seulement s'il répond et annonce la nouvelle version. Sinon, PartyHub revient à
   la version précédente. Si la nouvelle version avait modifié la base, la copie faite à l'étape 2 est remise en
   place, car l'ancienne version refuse une base plus récente.

L'interruption dure en général moins d'une minute, plus le téléchargement de l'image.

Le résultat de la dernière tentative est affiché dans l'administration (réussie, échouée, ou annulée avec retour à la
version précédente) avec son explication.

## 2. Installer le service de mise à jour (une seule fois)

Prérequis sur le serveur : `git`, `docker` avec le plugin Compose, `python3`, `curl`, `flock` et systemd (le cas de
CasaOS et de la plupart des distributions Debian ou Ubuntu). Le dépôt doit avoir été cloné (voir `README.md`).

```bash
cd /DATA/AppData/partyhub
sudo ./deploy/updater/install.sh
```

Le script écrit `/etc/partyhub-updater.env` (dossier, fichier Compose, adresse de contrôle), installe un service et un
minuteur systemd, puis les active. Vérifier :

```bash
systemctl status partyhub-update.timer          # « active (waiting) »
journalctl -u partyhub-update.service -n 20     # chaque minute, une ligne d'activité
```

Le service doit être installé sur une version de PartyHub qui le contient. Pour cette première mise à jour, passez
par la section 5.

Si le port publié n'est pas 8282, modifiez `PARTYHUB_HEALTH_URL` dans `/etc/partyhub-updater.env`.

## 3. Ce qui tourne sur le serveur

Le service d'hôte est le seul élément qui parle à Docker. L'application, elle, n'a aucun accès à Docker : elle écrit
seulement une demande dans le dossier `update` du volume, et lit l'état écrit par le service.

- Le service s'exécute en `root`, car il pilote Docker. Il ne fait que des commandes fixes (`git`, `docker compose`,
  `curl`) et n'accepte que des numéros de version `X.Y.Z` existant comme tags du dépôt.
- Les versions proposées viennent des *releases* GitHub publiées (ni brouillon, ni préversion). Le dépôt est
  `matosman40/Partyhub`.
- Fichiers échangés, dans le volume, dossier `update` (`/data/update`) : `request.json` (demande),
  `status.json` (dernière tentative), `updater-heartbeat.json` (présence du service), `server-heartbeat.json`
  (version et parties en cours).

Lire l'état à la main :

```bash
sudo cat "$(sudo docker volume inspect partyhub-data --format '{{ .Mountpoint }}')/update/status.json"
```

## 4. Règles à respecter

- **Ne modifiez pas les fichiers du dépôt à la main** (surtout `compose.yaml`). Le service refuse de mettre à jour un
  dépôt modifié, pour ne pas écraser vos changements. Les réglages se mettent dans `.env` (voir `.env.example`), qui
  n'est pas suivi par git.
- Le dépôt est positionné sur un **tag de version** (état « HEAD détaché »). Un `git pull` seul ne fonctionne plus :
  utilisez la section 5.
- Pas de retour à une version antérieure depuis l'administration : seule une version plus récente est proposée.
  Pour revenir en arrière à la main, voir la section 5 (et restaurer une sauvegarde si la base a été migrée).
- Les sauvegardes de la base sont dans `/data/backups` (créées avant chaque mise à jour, et régulièrement). Elles
  contiennent les profils : traitez-les comme des données personnelles.

## 5. Mise à jour à la main

```bash
cd /DATA/AppData/partyhub
sudo git fetch --tags
sudo git tag -l 'v*' --sort=-v:refname | head -n 5     # les dernières versions publiées
sudo git checkout v0.13.0                               # remplacer par la version voulue
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps                                  # doit afficher « healthy »
```

Consulter le changelog de la version avant (`CHANGELOG.md`, ou les notes de la release sur GitHub) : il indique si une
action manuelle est nécessaire.

Pour revenir à une version précédente, même procédure avec son tag. Si la version qu'on quitte a migré la base, le
retour à une version antérieure refusera de démarrer : restaurez alors la copie faite juste avant la mise à jour
(voir `docs/CASAOS.md`, section 7).

## 6. Dépannage

| Message affiché | Cause et action |
| --- | --- |
| « L’installeur n’est pas actif sur l’hôte » | Le service n'est pas installé, ou son minuteur est arrêté. Lancer `sudo ./deploy/updater/install.sh`, puis `systemctl status partyhub-update.timer`. |
| « Une partie est en cours » | La mise à jour est réservée à un moment sans partie. Elle reste possible une fois la partie terminée. |
| « Une mise à jour est déjà demandée » | Une demande est en attente ou en cours. Elle peut être annulée tant que l'hôte ne l'a pas prise en charge. |
| « Des fichiers de … ont été modifiés à la main » | Un fichier du dépôt a changé. `cd /DATA/AppData/partyhub && git status` pour voir lequel, puis `git checkout -- <fichier>` s'il s'agit d'une modification non voulue. |
| « Impossible de joindre GitHub » | Réseau ou pare-feu. La version précédente tourne toujours. Réessayer plus tard. |
| « Téléchargement de l'image … impossible » | Le registre GHCR est injoignable ou la version n'existe pas encore sous forme d'image. La version précédente tourne toujours. |
| « La nouvelle version a modifié la base et la sauvegarde est introuvable » | Le serveur reste arrêté. Restaurer à la main la copie de `/data/migrations` (voir `docs/CASAOS.md`, section 7), puis `sudo docker compose up -d`. |
| « Retour à la version précédente » | La nouvelle version n'a pas démarré. PartyHub tourne en version précédente. Consulter `sudo docker compose logs` pour la cause, avant de réessayer. |

Journal du service : `journalctl -u partyhub-update.service`.

## 7. Désinstaller le service

```bash
sudo systemctl disable --now partyhub-update.timer
sudo rm -f /etc/systemd/system/partyhub-update.service /etc/systemd/system/partyhub-update.timer /etc/partyhub-updater.env
sudo systemctl daemon-reload
```

PartyHub continue de fonctionner, et les mises à jour se font à la main (section 5).

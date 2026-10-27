# Sauvegarde de PartyHub

La sauvegarde copie chaque nuit deux volumes Docker :

- `partyhub-data` : les données (salles, comptes, historique, jeux installés) ;
- `partyhub-caddy-data` : l’autorité du certificat HTTPS. **Le perdre oblige à réinstaller le certificat racine
  sur chaque appareil** ; c’est la raison principale de cette sauvegarde.

## Installer (une fois)

Depuis le dossier de l’installation, sur l’hôte :

```bash
cd /root/partyhub
sudo ./deploy/sauvegarde/install.sh
```

## Fonctionnement

- Chaque nuit à 3 h 17, le conteneur `partyhub` est arrêté quelques secondes pour que la base SQLite soit
  copiée sans changer, puis redémarré, même si la copie échoue.
- Les archives sont écrites dans `/root/partyhub-sauvegardes/` (nom : `<volume>-AAAAMMJJ-HHMMSS.tar.gz`).
- Chaque archive est relue après création ; une archive illisible est signalée dans le journal.
- Seules les 14 plus récentes de chaque volume sont gardées.

Réglages facultatifs dans `/etc/partyhub-sauvegarde.env` : `PARTYHUB_SAUVEGARDES` (dossier) et
`PARTYHUB_SAUVEGARDES_GARDER` (nombre d’archives gardées).

## Vérifier

```bash
sudo systemctl start partyhub-sauvegarde.service     # lancer une sauvegarde maintenant
journalctl -u partyhub-sauvegarde.service -n 30      # voir le résultat
systemctl list-timers partyhub-sauvegarde.timer      # prochaine exécution
ls -lh /root/partyhub-sauvegardes/                   # archives présentes
```

## Restaurer

Restauration d’un volume à partir d’une archive (le serveur doit être arrêté) :

```bash
docker stop partyhub
docker run --rm -v partyhub-data:/dest -v /root/partyhub-sauvegardes:/sauvegarde:ro alpine:3.20 \
  sh -c 'rm -rf /dest/* && tar xzf /sauvegarde/partyhub-data-AAAAMMJJ-HHMMSS.tar.gz -C /dest'
docker start partyhub
```

Pour `partyhub-caddy-data`, remplacer les noms. Les archives ne sont **pas** copiées hors de la machine :
pour se prémunir contre la perte du disque, copiez périodiquement le dossier `/root/partyhub-sauvegardes/`
ailleurs.

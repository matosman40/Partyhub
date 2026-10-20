# HTTPS sur le réseau local (micro, caméra et mouvement)

Sur un téléphone ou une tablette, le navigateur ne donne accès au **micro**, à la **caméra** et aux **capteurs de
mouvement** (gyroscope, accéléromètre) qu'en HTTPS.
Une adresse `http://192.168.x.x:8282` ne suffit donc pas pour le test des appareils, ni pour un jeu qui utilise
la caméra ou l'inclinaison du téléphone (Micro-Défis, Funambule). Cette page explique comment servir PartyHub en `https://` sur le réseau local, avec un certificat
interne émis par Caddy.

Le HTTPS ne demande ni nom de domaine ni ouverture de la box. L'inconvénient : le certificat n'est pas reconnu
par défaut. Il faut une fois installer le **certificat racine** de Caddy sur chaque appareil qui se connecte.

Pour un accès depuis Internet, voir plutôt [REMOTE-ACCESS.md](REMOTE-ACCESS.md).

## 1. Installer PartyHub en HTTPS

L'installation sert PartyHub en HTTPS directement, il n'y a pas d'étape supplémentaire. Depuis le dossier de PartyHub
(là où se trouve `compose.yaml`) :

```bash
sudo sh install.sh
```

Le script détecte l'adresse du serveur sur le réseau local (par exemple `192.168.1.156`), la note dans `.env` comme
`PARTYHUB_HOST`, puis lance PartyHub. Pour la fixer soi-même : `sudo sh install.sh 192.168.1.156`.

Ce que cela met en place :

- Caddy sert `https://192.168.1.156` sur le port 443 ; PartyHub n'est plus accessible en clair sur le port 8282 ;
- les cookies de session ne circulent qu'en HTTPS (réglage `COOKIE_SECURE`, activé par défaut) ;
- Caddy transmet l'adresse réelle des joueurs à PartyHub (réglage `TRUST_PROXY`, réseau Docker par défaut).

Ces réglages, comme les autres de `.env`, se modifient dans l'administration (**Système → Réglages du serveur**).
Seule l'adresse (`PARTYHUB_HOST`) et le port HTTPS (`PARTYHUB_HTTPS_PORT`) restent dans `.env` : ils dépendent du
conteneur, pas du serveur. Après un changement de `PARTYHUB_HOST`, relancez avec `sudo docker compose up -d`.

## 2. Installer le certificat racine

Le certificat racine se télécharge depuis PartyHub, sans passer par le serveur :

1. Ouvrez `https://192.168.1.156` sur l'appareil. Le navigateur affiche un avertissement : c'est normal tant que le
   certificat n'est pas installé. Choisissez **Avancé**, puis **Continuer**.
2. Ouvrez la page **Installer le certificat HTTPS** (menu de l'accueil, ou `https://192.168.1.156/certificat`).
3. Touchez **Télécharger le certificat**, puis suivez les étapes affichées pour votre appareil.

La page reconnaît l'appareil et ouvre les instructions correspondantes : iPhone et iPad, Android, Windows, Mac, Linux.
Les autres appareils restent disponibles dans une section repliée. Les libellés des menus varient selon la marque et
la version du système.

Le certificat est le même pour tous les appareils. Il s'installe une fois par appareil, et il reste valable tant que le
volume `partyhub-caddy-data` n'est pas supprimé.

> Version plus ancienne (sans la page) : le fichier se récupère sur le serveur avec
> `sudo docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./partyhub-root.crt`,
> puis se transfère à l'appareil (AirDrop, mail, clé USB).

## 3. Vérifier

1. Ouvrez `https://192.168.1.156` sur le téléphone : le cadenas doit être fermé, sans avertissement.
2. Ouvrez `https://192.168.1.156/test-appareils` (ou le lien « Tester micro, caméra, image » du menu d'accueil) :
   « Activer le micro » et « Tester la caméra » doivent demander l'autorisation.
3. Dans la même page, la section « Tester le mouvement » doit demander l'autorisation des capteurs (sur iPhone et iPad),
   puis afficher le point qui suit l'inclinaison quand on penche le téléphone.

Si l'avertissement persiste, le certificat racine n'est pas installé ou n'est pas approuvé (voir l'étape 2).

## Points d'attention

- **Supprimer le volume `partyhub-caddy-data`** (ou réinstaller Caddy avec un nouveau volume) crée une nouvelle
  autorité : il faudra réinstaller le certificat racine partout.
- **Changer `PARTYHUB_HOST`** (par exemple, une nouvelle adresse IP de la box) impose un nouveau certificat : il est
  émis automatiquement, mais les appareils doivent accepter la nouvelle adresse.
- **CasaOS** : un seul fichier suffit pour PartyHub et Caddy, sans ligne de commande : `deploy/casaos/compose.https.yaml`
  (voir [CASAOS.md](CASAOS.md), section 10).
- Le certificat est valable pour l'adresse du serveur uniquement. Une adresse IP qui change (DHCP) casse l'accès :
  réservez une adresse fixe sur la box.
- **Mouvement** : le gyroscope et l'accéléromètre suivent les mêmes règles que le micro. Sans HTTPS, Micro-Défis et
  Funambule indiquent que le téléphone ne transmet pas le mouvement, et le défi ne peut pas être réussi. Sur iPhone, un
  refus se corrige dans les réglages de Safari (Mouvement et orientation), ou en effaçant les données du site.
- **En-tête `Permissions-Policy`** : PartyHub autorise lui-même le gyroscope, l'accéléromètre, le micro et la caméra
  pour ses pages. Le proxy Caddy transmet cet en-tête sans le modifier, dans Docker et sur CasaOS.
- Testez la configuration sur votre serveur avant une soirée (étape 3).

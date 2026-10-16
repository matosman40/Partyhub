# HTTPS sur le réseau local (micro et caméra)

Sur un téléphone ou une tablette, le navigateur ne donne accès au **micro** et à la **caméra** qu'en HTTPS.
Une adresse `http://192.168.x.x:8282` ne suffit donc pas pour le test des appareils ni pour un jeu qui utilise
la caméra. Cette page explique comment servir PartyHub en `https://` sur le réseau local, avec un certificat
interne émis par Caddy.

Le HTTPS ne demande ni nom de domaine ni ouverture de la box. L'inconvénient : le certificat n'est pas reconnu
par défaut. Il faut une fois installer le **certificat racine** de Caddy sur chaque appareil qui se connecte.

Pour un accès depuis Internet, voir plutôt [REMOTE-ACCESS.md](REMOTE-ACCESS.md).

## 1. Démarrer PartyHub en HTTPS

Depuis le dossier de PartyHub (là où se trouve `compose.yaml`) :

```bash
cp -n .env.example .env
```

Dans `.env`, indiquez l'adresse du serveur sur le réseau local (celle que vous tapez aujourd'hui, sans `http://`
ni port) :

```bash
PARTYHUB_HOST=192.168.1.156
```

Puis lancez PartyHub avec la surcouche HTTPS :

```bash
sudo docker compose -f compose.yaml -f deploy/https/compose.https.yaml up -d
```

Cette commande :

- lance Caddy sur le port 443 de la machine, qui sert `https://192.168.1.156` ;
- ferme l'accès direct en `http://…:8282` (les cookies de session ne circulent qu'en HTTPS) ;
- règle `COOKIE_SECURE=true` et `TRUST_PROXY` pour le réseau Docker.

> Docker Compose 2.24.4 ou plus récent est nécessaire. Vérifiez avec `docker compose version`.

Pour revenir au mode HTTP d'origine, relancez sans la surcouche :

```bash
sudo docker compose up -d
```

Pensez alors à remettre `COOKIE_SECURE=false` dans `.env` (le mode HTTP ne fonctionne plus avec `true`).

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
> `sudo docker compose -f compose.yaml -f deploy/https/compose.https.yaml cp caddy:/data/caddy/pki/authorities/local/root.crt ./partyhub-root.crt`,
> puis se transfère à l'appareil (AirDrop, mail, clé USB).

## 3. Vérifier

1. Ouvrez `https://192.168.1.156` sur le téléphone : le cadenas doit être fermé, sans avertissement.
2. Ouvrez `https://192.168.1.156/test-appareils` (ou le lien « Tester micro, caméra, image » du menu d'accueil) :
   « Activer le micro » et « Tester la caméra » doivent demander l'autorisation.

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
- La surcouche n'a été vérifiée qu'à la syntaxe de ses fichiers. Testez-la sur votre serveur avant une soirée.

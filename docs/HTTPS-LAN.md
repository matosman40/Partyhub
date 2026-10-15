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

Le certificat racine est le même pour tous les appareils. Récupérez-le une fois sur la machine qui héberge PartyHub :

```bash
sudo docker compose -f compose.yaml -f deploy/https/compose.https.yaml cp caddy:/data/caddy/pki/authorities/local/root.crt ./partyhub-root.crt
```

Envoyez le fichier `partyhub-root.crt` au téléphone ou à la tablette (AirDrop, mail, clé USB, ou transfert local).
Les libellés des menus varient selon la marque et la version du système.

### iPhone et iPad

1. Ouvrez le fichier. Réglages → *Profil de configuration téléchargé* → **Installer** (code de l'appareil demandé).
2. Ensuite, Réglages → Général → Informations → **Réglages des certificats** → activez la **confiance totale**
   pour « Caddy Local Authority » (le nom affiché peut contenir l'année).

Sans cette deuxième étape, Safari continue d'afficher un avertissement.

### Android

1. Paramètres → Sécurité (ou « Sécurité et confidentialité ») → Chiffrement et identifiants →
   **Installer un certificat** → **Certificat CA**.
2. Choisissez le fichier `partyhub-root.crt`.

Chrome utilise ce certificat. Certaines applications Android l'ignorent, mais le navigateur suffit pour PartyHub.

### Ordinateur (optionnel)

Sous Windows, double-cliquez sur le fichier, puis « Installer le certificat » → **Autorités de certification racines de
confiance**. Sous macOS, ouvrez-le dans Trousseau d'accès et réglez la confiance sur « Toujours faire confiance ».

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
- **CasaOS** installe PartyHub en HTTP par défaut. La surcouche HTTPS se lance en ligne de commande, depuis le dossier
  de PartyHub.
- Le certificat est valable pour l'adresse du serveur uniquement. Une adresse IP qui change (DHCP) casse l'accès :
  réservez une adresse fixe sur la box.
- La surcouche n'a été vérifiée qu'à la syntaxe de ses fichiers. Testez-la sur votre serveur avant une soirée.

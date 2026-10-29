# Accès à distance sécurisé

PartyHub est conçu pour le réseau local. Ouvrir le port 8282 directement sur Internet est déconseillé :
le trafic serait en clair et l'administration serait exposée.

Pour le seul réseau local, avec micro et caméra sur les téléphones, voir [HTTPS-LAN.md](HTTPS-LAN.md).

Deux options, par ordre de préférence.

## Option A (recommandée) : VPN

Installer un VPN maillé comme WireGuard ou Tailscale sur le serveur et sur les appareils qui en ont besoin.
Les joueurs à distance se connectent au VPN puis ouvrent l'adresse locale ou VPN du serveur. Aucun port n'est
ouvert sur la box, et l'administration n'est accessible qu'aux appareils autorisés.

## Option B : reverse proxy HTTPS

Obligatoire dès que le site est accessible depuis Internet : sans HTTPS, les mots de passe et les cookies voyagent en clair.

### 1. Prérequis

- Un nom de domaine pointant vers l'adresse publique de votre box.
- Redirection des ports 80 et 443 de la box vers le serveur (le port 80 sert au certificat Let's Encrypt).

### 2. Caddy (certificat automatique)

Exemple de `Caddyfile` :

```caddy
partyhub.example.com {
    # L'administration n'est jamais accessible depuis Internet.
    @admin path /admin /admin/* /api/admin /api/admin/*
    respond @admin 403

    # Transmission HTTP et WebSocket (Caddy gère l'upgrade automatiquement).
    # PartyHub n'est plus publié sur l'hôte : ce proxy rejoint le conteneur sur le réseau Docker (voir le README).
    reverse_proxy partyhub:8282

    header {
        Strict-Transport-Security "max-age=31536000"
        -Server
    }
}
```

Dans `.env`, passer `COOKIE_SECURE=true` puis relancer le conteneur :

```bash
sudo docker compose up -d
```

L'administration reste accessible sur le réseau local, par HTTPS : `https://<adresse-locale>/admin`.

### 3. Autres proxys

Nginx Proxy Manager, Traefik ou Nginx fonctionnent de la même façon. Trois points à ne pas oublier :

- transmettre les en-têtes `Upgrade` et `Connection` pour Socket.IO (`/socket.io/`) ;
- bloquer `/admin` et `/api/admin` depuis l'extérieur ;
- activer `COOKIE_SECURE=true`.

### 4. Adresse réelle des joueurs

Le proxy transmet l'adresse du joueur dans l'en-tête `X-Forwarded-For`. PartyHub ne le lit que si la connexion vient
d'un proxy de confiance (variable `TRUST_PROXY`, `loopback` par défaut dans le code, `172.16.0.0/12` dans `compose.yaml`). Avec Docker, la connexion arrive souvent
depuis la passerelle du réseau Docker, et non depuis le proxy : sans réglage, tous les joueurs semblent venir de la
même adresse, ce qui fausse le ralentissement des codes inconnus et les journaux.

Dans `.env`, indiquez le réseau Docker, puis relancez le conteneur :

```bash
TRUST_PROXY=172.16.0.0/12
```

```bash
sudo docker compose up -d
```

Ne mettez que le réseau du proxy. Une valeur trop large (par exemple `0.0.0.0/0`) permettrait à n'importe quel client
de se faire passer pour une autre adresse.

## Sécurité supplémentaire

- Changer le mot de passe administrateur pour une phrase longue et unique.
- Garder PartyHub à jour avec une version publiée (`git checkout vX.Y.Z`, puis `docker compose pull` et
  `docker compose up -d`, voir [MISE-A-JOUR.md](MISE-A-JOUR.md)).
- Ne pas publier le port 8282 à la fois en direct et derrière le proxy.
- Surveiller les journaux : `sudo docker compose logs --since 24h | grep -i "tentative"`.

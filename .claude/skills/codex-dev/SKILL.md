---
name: codex-dev
description: "Claude chef de projet, Codex développeur associé. À utiliser quand l'utilisateur demande de faire coder Codex, de déléguer une tâche de développement à Codex, d'avoir l'avis de Codex, ou de travailler en duo Claude/Codex sur PartyHub. Claude cadre, découpe, rédige la consigne, envoie la tâche par scripts/codex-dev.mjs, relit le diff, lance les contrôles et renvoie les corrections à Codex jusqu'à ce que le travail soit livrable."
---

# Claude chef de projet, Codex développeur

Sur PartyHub, tu es le chef de projet et Codex est ton développeur associé. Tu ne codes pas la tâche toi-même : tu la cadres, tu la confies à Codex, tu contrôles ce qu'il rend et tu en réponds devant l'utilisateur. Le rôle de Codex est décrit dans `AGENTS.md`, à la racine du dépôt, qu'il lit à chaque démarrage.

## Déroulé

1. **Cadrer.** Reformule le besoin et lis le code concerné, assez pour écrire une consigne précise. Si un point de décision revient à l'utilisateur (règle de jeu, choix visuel, changement de `grille.ts` ou `grille-themes.ts`), pose-lui la question **avant** de déléguer. Pour les fichiers de la grille, il faut un plan accepté.
2. **Découper.** Une consigne = un thème, une règle ou un bug, comme le veut CLAUDE.md. Une grosse demande devient plusieurs tâches successives, chacune relue avant la suivante.
3. **Rédiger la consigne** dans un fichier de ton dossier temporaire (jamais dans le dépôt), sur ce modèle :

   ```markdown
   # Tâche : <titre court>

   ## Contexte

   <pourquoi, ce que l'utilisateur veut obtenir>

   ## À faire

   <le changement attendu, précis ; fichiers et fonctions concernés avec leur chemin>

   ## Hors périmètre

   <ce qu'il ne faut pas toucher>

   ## Critères d'acceptation

   - <comportement vérifiable>
   - <test à ajouter ou à faire passer>
   - Contrôles de CLAUDE.md verts pour les paquets touchés.
   ```

4. **Déléguer**, à la racine du dépôt :

   ```bash
   node scripts/codex-dev.mjs < <consigne.md>
   ```

   Une tâche Codex dure souvent plusieurs minutes : lance la commande avec `run_in_background` et attends la notification, sans interroger la sortie en boucle. Pour une simple analyse ou un second avis sans écriture, ajoute `--lecture`.
   Le script affiche le rapport de Codex, les fichiers modifiés, puis l'identifiant de session à garder pour la suite.

5. **Contrôler.** Ne crois pas le rapport sur parole :
   - relis `git diff` et les fichiers non suivis, en entier ;
   - vérifie que le diff reste dans le périmètre et suit le style du code voisin ;
   - relance toi-même les contrôles de CLAUDE.md (build `shared`, tests du paquet, typecheck, lint, format). Les agents `controleur-livraison` et `surgeon-reviewer` peuvent s'en charger si l'utilisateur le souhaite ;
   - pour un changement visuel, vérifie dans un navigateur (serveur de test sur le port 8294).
6. **Renvoyer les corrections** dans la même session, pour que Codex garde son contexte :

   ```bash
   node scripts/codex-dev.mjs --reprendre <id-de-session> < <retour.md>
   ```

   Le retour cite les problèmes précisément (fichier, ligne, ce qui est attendu). Après trois allers-retours sans progrès, arrête et expose la situation à l'utilisateur plutôt que d'insister ou de corriger en douce.

7. **Rendre compte** à l'utilisateur : ce qui a été fait, par qui, les contrôles passés ou non, ce qui reste ouvert. Ne committe et ne pousse qu'après son accord, avec les lignes de fin de commit de CLAUDE.md.

## Règles

- Codex ne committe pas, ne pousse pas et ne change pas de branche. Si son diff contient un commit ou un changement de branche, signale-le à l'utilisateur.
- Petites retouches (une faute, un import oublié) : tu peux les faire toi-même après relecture et le dire dans ton compte rendu. Toute correction de fond repasse par Codex.
- Ne passe jamais `--dangerously-bypass-approvals-and-sandbox` à Codex et n'élargis pas son bac à sable au-delà du dépôt.
- Si `node scripts/codex-dev.mjs` ne trouve pas Codex, dis-le à l'utilisateur. Le Codex CLI se trouve aussi dans l'extension VS Code d'OpenAI ; son chemin peut être donné dans `CODEX_BIN`.

import type { GameRelease } from '@partyhub/shared';

/**
 * Journal des versions de chaque jeu, affiché sur sa fiche. Une entrée par version ou par mise à jour notable, la
 * plus récente en premier. Le numéro de tête doit être celui du manifeste du jeu : `release-notes.test.ts` le vérifie
 * pour tous les jeux du registre. Quand un jeu change, ajoutez une entrée ici, en tête, et augmentez son `version`
 * dans le manifeste si le changement le justifie.
 *
 * Les dates sont celles de la version de PartyHub qui a publié le changement (voir CHANGELOG.md).
 */
export const RELEASE_NOTES: Readonly<Partial<Record<string, readonly GameRelease[]>>> = {
  'tribunal-absurde': [
    {
      version: '1.0.0',
      date: '2026-10-18',
      changes: [
        'Nouveau jeu pour 3 à 10 joueurs : une situation improbable apparaît, chacun écrit sa défense, puis le jury (les autres joueurs) vote anonymement pour la meilleure.',
        'Quatre ambiances : humour noir, mauvaise foi, excuses impossibles, adultes. « Mélange » change d’ambiance à chaque affaire.',
        'Chaque vote rapporte 100 points à l’auteur. La défense la plus votée est acquittée, les autres sont condamnées.',
      ],
    },
  ],
  'imposteur-parmi-nous': [
    {
      version: '1.0.0',
      date: '2026-10-18',
      changes: [
        'Nouveau jeu pour 3 à 10 joueurs : l’imposteur ignore le mot secret. Chacun dit une phrase, puis tout le monde vote pour le démasquer.',
        'Quatre modes : espion (un mot proche), intrus (un mot d’une autre catégorie), mot interdit (le mot ne doit jamais être prononcé), rôle secret (aucun mot).',
        'L’imposteur gagne s’il survit au vote, ou s’il devine le mot après avoir été démasqué.',
      ],
    },
  ],
  'telephone-arabe': [
    {
      version: '1.0.0',
      date: '2026-10-18',
      changes: [
        'Nouveau jeu pour 2 à 10 joueurs : une phrase absurde est dessinée au doigt, puis décrite par le joueur suivant, et ainsi de suite.',
        'Temps par étape libre, de 45 secondes ou de 30 secondes. Phrases de départ tirées au hasard, ou écrites par les joueurs.',
        'À la fin, l’écran principal montre toute l’évolution de chaque phrase, de la phrase de départ jusqu’au résultat final.',
      ],
    },
  ],
  'plateau-fete': [
    {
      version: '1.1.0',
      date: '2026-10-18',
      changes: [
        'Les mêmes six défis de plus que Micro-Défis (glisser, répéter le motif, pincer, lancer, applaudir, cacher la lumière), tirés au sort dans les mini-jeux du plateau.',
      ],
    },
    {
      version: '1.0.0',
      date: '2026-10-18',
      changes: [
        'Nouveau jeu de plateau pour 2 à 8 joueurs : chacun lance le dé sur son téléphone, puis les pions avancent sur un anneau de 60 cases.',
        'Trois étoiles à acheter pour 20 pièces, des cases à pièces, des événements (pari, pickpocket, grand saut) et un mini-jeu de cinq défis tous les trois tours.',
        'Une partie dure environ 25 minutes, 40 tours. Le plus d’étoiles gagne, puis le plus de pièces.',
      ],
    },
  ],
  'quiz-party': [
    {
      version: '1.1.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },

    {
      version: '1.1.0',
      date: '2026-10-18',
      changes: [
        'Thèmes des joueurs : chacun donne quelques mots-clés à tour de rôle, et l’IA écrit les questions à partir de ces thèmes.',
        'Sans IA, ou si sa réponse est inutilisable, les questions intégrées prennent le relais.',
      ],
    },
    { version: '1.0.0', date: '2026-10-14', changes: ['Première version publique.'] },
  ],
  'phrases-trous': [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },

    {
      version: '1.0.0',
      date: '2026-10-18',
      changes: [
        'Nouveau jeu de la catégorie Quiz : l’IA écrit des phrases à trou à partir des mots-clés de chaque joueur.',
        'À chaque tour, chacun pose une carte de sa main dans le trou, puis tout le monde vote anonymement (100 points par vote reçu).',
      ],
    },
  ],
  association: [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },
    { version: '1.0.0', date: '2026-10-14', changes: ['Première version publique.'] },
  ],
  'plutot-qui': [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },
    { version: '1.0.0', date: '2026-10-14', changes: ['Première version publique.'] },
  ],
  'aventure-ia': [
    {
      version: '1.2.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },

    {
      version: '1.2.0',
      date: '2026-10-18',
      changes: [
        'Le personnage qui parle est affiché en grand, à côté de la scène, avec sa réplique.',
        'Description raccourcie, pour tenir sur la carte du catalogue.',
      ],
    },
    {
      version: '1.0.0',
      date: '2026-10-17',
      changes: [
        'Six thèmes, chacun avec son intrigue de secours.',
        'Scènes variées : rencontre, dialogue (le lien avec chaque personnage évolue, de « hostile » à « allié »), énigme, halte et affrontement.',
        'Progression : chaque réussite rapporte de l’expérience, jusqu’au niveau 5.',
        'Personnages gardés dans le profil (jusqu’à quarante), avec des portraits et des fonds générés par une IA d’image.',
      ],
    },
    {
      version: '1.0.0',
      date: '2026-10-16',
      changes: [
        'Aventure racontée en direct : l’écran principal génère le monde et six personnages, et les joueurs votent chaque choix.',
      ],
    },
  ],
  'plus-ou-moins': [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },
    { version: '1.0.0', date: '2026-10-14', changes: ['Première version publique.'] },
  ],
  reflexe: [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },
    { version: '1.0.0', date: '2026-10-14', changes: ['Première version publique.'] },
  ],
  'micro-defis': [
    {
      version: '1.1.0',
      date: '2026-10-18',
      changes: [
        'Six défis de plus, qui utilisent les gestes et les capteurs du téléphone : glisser dans l’ordre des flèches, répéter un motif de vibrations, pincer à la bonne taille, lancer le ballon, applaudir, couvrir la lumière de la caméra.',
        'Le motif et la vibration ne sont pas proposés sur tous les téléphones : sans vibration, le motif s’affiche à l’écran ; la caméra et le micro demandent une autorisation.',
      ],
    },
    {
      version: '1.0.0',
      date: '2026-10-17',
      changes: [
        'Nouveau jeu : une succession de défis éclair, les mêmes pour tout le monde (secouer, garder le téléphone à plat, le faire tourner, souffler, tapoter, appuyer au bon moment).',
        'Lisibilité sur la TV et le téléphone : textes plus grands, défis centrés, pad de défi plus grand.',
        'Corrections : le seuil du défi « Souffle » est visible, un plateau tournant compte les tours à 360 degrés, et les secousses sont comptées sur certains Android.',
      ],
    },
  ],
  'gags-en-rafale': [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },

    {
      version: '1.0.0',
      date: '2026-10-18',
      changes: [
        'Nouveau jeu, seul ou à plusieurs : six gags d’une seconde sur le téléphone (lancer la crêpe, écraser une mouche, gonfler un ballon, ne pas toucher le bouton rouge, faire la statue, gratter un ticket).',
        'Une réussite rapporte 100 points, plus jusqu’à 60 pour la rapidité.',
      ],
    },
  ],
  funambule: [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },

    {
      version: '1.0.0',
      date: '2026-10-17',
      changes: [
        'Nouveau jeu : chaque joueur tient son funambule sur le fil en penchant son téléphone contre le vent, qui se renforce d’une manche à l’autre.',
        'Une traversée se termine à sa durée, même si le téléphone cesse d’envoyer ses mesures.',
        'L’écran principal est centré, avec son propre décor (un chapiteau au crépuscule).',
      ],
    },
  ],
  'bombes-party': [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },

    {
      version: '1.0.0',
      date: '2026-10-18',
      changes: [
        'Niveau plus grand (25 × 19 cases) et jusqu’à dix joueurs.',
        'Le téléphone suit son personnage dans un cadre de taille inchangée, bloqué sur les bords du niveau.',
        'Le classement latéral passe sur deux colonnes, pour que le plateau reste grand.',
      ],
    },
    {
      version: '1.0.0',
      date: '2026-10-17',
      changes: ['Écran principal plus grand et animations de points.'],
    },
    { version: '1.0.0', date: '2026-10-14', changes: ['Première version publique.'] },
  ],
  'cartes-couleurs': [
    {
      version: '1.0.0',
      date: '2026-10-18',
      changes: [
        'Logo et décor propres (il empruntait auparavant le décor d’un autre jeu).',
        'Icône 🌈, distincte de celle des autres jeux.',
      ],
    },
    {
      version: '1.0.0',
      date: '2026-10-16',
      changes: [
        'Main triée par grandeur : les cartes vont du plus petit au plus grand, les actions et les jokers à la suite.',
      ],
    },
    { version: '1.0.0', date: '2026-10-14', changes: ['Première version publique.'] },
  ],
  'cartes-coco': [
    {
      version: '1.0.0',
      date: '2026-10-18',
      changes: ['Logo et décor propres (il empruntait auparavant le décor d’un autre jeu).'],
    },
    { version: '1.0.0', date: '2026-10-14', changes: ['Première version publique.'] },
  ],
  president: [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },

    {
      version: '1.0.0',
      date: '2026-10-16',
      changes: [
        'Main triée par grandeur : les cartes vont du plus petit au plus grand, les actions et les jokers à la suite.',
      ],
    },
    { version: '1.0.0', date: '2026-10-14', changes: ['Première version publique.'] },
  ],
  promoteur: [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },
    { version: '1.0.0', date: '2026-10-14', changes: ['Première version publique.'] },
  ],
  'loups-village': [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },
    { version: '1.0.0', date: '2026-10-14', changes: ['Première version publique.'] },
  ],
  sudoku: [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },

    {
      version: '1.0.0',
      date: '2026-10-18',
      changes: ['Logo et décor propres (il empruntait auparavant le décor d’un autre jeu).'],
    },
    {
      version: '1.0.0',
      date: '2026-10-17',
      changes: ['Accessibilité : la grille est annoncée correctement aux lecteurs d’écran.'],
    },
    { version: '1.0.0', date: '2026-10-14', changes: ['Première version publique.'] },
  ],
  solitaire: [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },

    {
      version: '1.0.0',
      date: '2026-10-18',
      changes: ['Logo et décor propres (il empruntait auparavant le décor d’un autre jeu).'],
    },
    {
      version: '1.0.0',
      date: '2026-10-17',
      changes: ['Accessibilité : la carte cachée est annoncée comme une image.'],
    },
    { version: '1.0.0', date: '2026-10-14', changes: ['Première version publique.'] },
  ],
  taquin: [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },

    {
      version: '1.0.0',
      date: '2026-10-18',
      changes: [
        'Logo et décor propres (il empruntait auparavant le décor d’un autre jeu).',
        'Icône 🔀, distincte de celle des autres jeux.',
      ],
    },
    {
      version: '1.0.0',
      date: '2026-10-17',
      changes: ['Accessibilité : la grille est annoncée correctement aux lecteurs d’écran.'],
    },
    { version: '1.0.0', date: '2026-10-14', changes: ['Première version publique.'] },
  ],
  'mots-croises': [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },

    {
      version: '1.0.0',
      date: '2026-10-18',
      changes: ['Logo et décor propres (il empruntait auparavant le décor d’un autre jeu).'],
    },
    {
      version: '1.0.0',
      date: '2026-10-17',
      changes: ['Accessibilité : la grille est annoncée correctement aux lecteurs d’écran.'],
    },
    { version: '1.0.0', date: '2026-10-14', changes: ['Première version publique.'] },
  ],
  'rami-51': [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },

    {
      version: '1.0.0',
      date: '2026-10-14',
      changes: [
        'Nouveau jeu : Rami 51 de 2 à 5 joueurs, avec le jeu de 108 cartes.',
        'Ouverture à 51 points, tierce franche, échange de joker et rami sec.',
      ],
    },
  ],
  tarot: [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },

    {
      version: '1.0.0',
      date: '2026-10-18',
      changes: ['Une étape de la notice raccourcie, sans changer la règle.'],
    },
    {
      version: '1.0.0',
      date: '2026-10-14',
      changes: [
        'Nouveau jeu : Tarot à 4 joueurs, avec enchères, chien, écart, obligations de couleur et d’atout, Excuse, petit au bout et chelem.',
      ],
    },
  ],
  'poker-texas': [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },

    {
      version: '1.0.0',
      date: '2026-10-16',
      changes: [
        'Intégré à l’application : de 2 à 8 joueurs, avec blindes, mises, relances, tapis et pots secondaires.',
        'Les cartes privées ne sont jamais envoyées à l’écran principal ; les robots jouent avec une évaluation simple de leur main.',
      ],
    },
    {
      version: '1.0.0',
      date: '2026-10-14',
      changes: ['Première version : poker Texas hold’em, de 2 à 8 joueurs.'],
    },
  ],
  karaoke: [
    {
      version: '1.0.0',
      date: '2026-10-18',
      changes: ['Première version : chanter un passage de chanson YouTube, noté par les autres.'],
    },
  ],
  'imite-moi': [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },

    {
      version: '1.0.0',
      date: '2026-10-18',
      changes: ['Logo et décor propres (il empruntait auparavant le décor d’un autre jeu).'],
    },
    {
      version: '1.0.0',
      date: '2026-10-15',
      changes: [
        'Nouveau jeu : une consigne apparaît sur l’écran principal, avec une illustration à imiter ou un son.',
        'Chacun répond depuis son téléphone : une photo de la galerie, ou une photo prise avec la caméra.',
      ],
    },
  ],
  banquise: [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },

    {
      version: '1.0.0',
      date: '2026-10-15',
      changes: [
        'Nouveau jeu, de 2 à 8 joueurs : chaque personnage, importé ou dessiné, marche sur un îlot de banquise.',
        'Grille hexagonale, et barre de réactions sur l’écran principal.',
      ],
    },
  ],
  boum: [
    {
      version: '1.0.1',
      date: '2026-10-20',
      changes: ['Mise à jour technique : version alignée sur le code actuel de PartyHub.'],
    },

    {
      version: '1.0.0',
      date: '2026-10-18',
      changes: ['Logo et décor propres (il empruntait auparavant le décor d’un autre jeu).'],
    },
    {
      version: '1.0.0',
      date: '2026-10-15',
      changes: [
        'Nouveau jeu, de 2 à 12 joueurs : des manches tirées au hasard dans un pool de modes.',
        'Modes : réponse rapide, trous noirs, vrai ou faux, devine la chanson, où est-ce ?, et d’autres.',
      ],
    },
  ],
  'plateau-test': [
    {
      version: '1.0.0',
      date: '2026-10-15',
      changes: ['Premier plateau de test : essayer les déplacements et les émotions, sans partie.'],
    },
  ],
  'tennis-party': [
    {
      version: '1.1.0',
      date: '2026-10-18',
      changes: [
        'Rendu en perspective : terrain, tribunes et filet en 3D simulée, joueurs à leur échelle selon leur place sur le court.',
        'Règles du vrai tennis : score de chaque point, jeux, sets et tie-break, au choix un set ou le meilleur de trois sets.',
        'Championnats : une poule (tous contre tous) ou un tableau à élimination directe, avec classement final.',
        'Les robots ratent une balle sur cinq environ, pour que les échanges se terminent.',
      ],
    },
    {
      version: '1.0.0',
      date: '2026-10-18',
      changes: [
        'Première version : de 2 à 4 joueurs défendent chacun un côté du court avec leur raquette, pilotée par le téléphone.',
      ],
    },
  ],
};

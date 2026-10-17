import {
  sceneDraftSchema,
  type CharacterDraft,
  type EnemyDraft,
  type EpilogueDraft,
  type RosterDraft,
  type SceneDraft,
} from './schemas.js';
import type { FallbackArc, SceneSeed } from './fallback-arc.js';
import { FROMAGERIE_ARC } from './fallback-fromagerie.js';
import { PIGEONS_ARC } from './fallback-pigeons.js';
import { VAISSEAU_ARC } from './fallback-vaisseau.js';

/**
 * Histoire de secours : utilisée quand l’IA n’est pas configurée, injoignable ou répond hors format.
 * Chaque aventure de secours suit une intrigue écrite à la main : un monde, un objectif, des personnages
 * rencontrés et une suite de scènes qui se répondent. Les conséquences de chaque choix sont écrites d’avance,
 * donc l’histoire reste cohérente même sans IA. Les pouvoirs sont narratifs : aucun ne modifie les jets.
 */

type Arc = FallbackArc;

/** Quelles scènes de l’intrigue jouer, selon la durée choisie : toujours l’ouverture et le dénouement. */
const SCENE_PICKS: Record<number, readonly number[]> = {
  3: [0, 3, 5],
  4: [0, 1, 3, 5],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
};

const CHARACTERS: CharacterDraft[] = [
  {
    name: 'Mirelle',
    title: 'Cartographe des brumes',
    emoji: '🧭',
    backstory:
      'Elle dessine des cartes qui se modifient toutes seules la nuit. Personne ne sait si c’est un don ou une malédiction.',
    stats: { force: 2, ruse: 4, esprit: 3, charme: 2 },
    pvMax: 8,
    ability: { name: 'Trait de plume', text: 'Elle repère vite les raccourcis que les autres ne voient pas.' },
    flaw: 'Elle se perd dès qu’elle ne regarde pas une carte.',
    item: 'Une boussole qui pointe toujours vers le dessert.',
  },
  {
    name: 'Bernard',
    title: 'Forgeron du village',
    emoji: '🔨',
    backstory: 'Il répare tout, même les promesses. Son marteau siffle quand un mensonge se trouve à proximité.',
    stats: { force: 5, ruse: 1, esprit: 3, charme: 2 },
    pvMax: 10,
    ability: { name: 'Coup de marteau', text: 'Les portes et les pièges n’ont aucune chance contre lui.' },
    flaw: 'Il ne sait pas reculer, même quand il le devrait.',
    item: 'Un marteau qui sent la cannelle.',
  },
  {
    name: 'Ombelle',
    title: 'Diseuse de bonne aventure',
    emoji: '🔮',
    backstory: 'Ses prédictions se réalisent toujours, mais jamais dans le bon ordre.',
    stats: { force: 1, ruse: 3, esprit: 4, charme: 4 },
    pvMax: 6,
    ability: { name: 'Présage', text: 'Elle annonce parfois une issue, avec une certitude qui inquiète.' },
    flaw: 'Elle répond toujours par une énigme.',
    item: 'Un jeu de cartes usées, dont une est blanche.',
  },
  {
    name: 'Sapinette',
    title: 'Renarde pirate',
    emoji: '🦊',
    backstory: 'Elle a quitté la mer après une tempête qu’elle prétend avoir provoquée elle-même.',
    stats: { force: 3, ruse: 4, esprit: 2, charme: 3 },
    pvMax: 8,
    ability: { name: 'Pas de velours', text: 'Elle se glisse partout sans que personne ne l’entende.' },
    flaw: 'Elle ne résiste jamais à un trésor.',
    item: 'Une lunette qui voit à travers les coffres.',
  },
  {
    name: 'Théo',
    title: 'Gardien des livres interdits',
    emoji: '📚',
    backstory: 'Il sait presque tout, mais oublie toujours où il a rangé ses lunettes.',
    stats: { force: 1, ruse: 3, esprit: 5, charme: 2 },
    pvMax: 6,
    ability: { name: 'Mémoire d’éléphant', text: 'Il se souvient d’un détail utile dans chaque situation.' },
    flaw: 'Il s’arrête pour lire tous les panneaux.',
    item: 'Un livre qui murmure des conseils douteux.',
  },
  {
    name: 'Lou',
    title: 'Chanteuse de rue',
    emoji: '🎶',
    backstory: 'Sa voix ouvre les portes des tavernes et ferme la bouche des gardes.',
    stats: { force: 2, ruse: 2, esprit: 2, charme: 5 },
    pvMax: 9,
    ability: { name: 'Refrain entraînant', text: 'Les gens du lieu finissent souvent par fredonner avec elle.' },
    flaw: 'Elle chante quand elle devrait se taire.',
    item: 'Un accordéon à moitié cassé.',
  },
  {
    name: 'Brigitte',
    title: 'Garde-forestière',
    emoji: '🌿',
    backstory: 'Elle connaît chaque sentier et chaque animal, et refuse de couper le moindre arbre.',
    stats: { force: 4, ruse: 2, esprit: 3, charme: 2 },
    pvMax: 10,
    ability: { name: 'Oreille du sous-bois', text: 'Les animaux lui racontent ce qu’ils ont vu, à leur façon.' },
    flaw: 'Elle parle aux arbres, et ils répondent.',
    item: 'Un sifflet d’appel pour les bêtes.',
  },
  {
    name: 'Tic-Tac',
    title: 'Horloger de l’impossible',
    emoji: '⏰',
    backstory: 'Il répare des horloges qui n’existent pas encore. Ses rouages tournent parfois à l’envers.',
    stats: { force: 2, ruse: 4, esprit: 4, charme: 1 },
    pvMax: 7,
    ability: { name: 'Contretemps', text: 'Il devine toujours le moment exact où tout va basculer.' },
    flaw: 'Il ne peut pas s’empêcher de tout démonter.',
    item: 'Une clé à remonter qui fait tic-tac dans les oreilles.',
  },
  {
    name: 'Odile',
    title: 'Pâtissière de combat',
    emoji: '🥐',
    backstory: 'Elle transforme les crises en gâteaux, et pense que le sucre règle presque tout.',
    stats: { force: 3, ruse: 2, esprit: 2, charme: 4 },
    pvMax: 8,
    ability: { name: 'Pâte feuilletée', text: 'Elle sort toujours la bonne recette au bon moment.' },
    flaw: 'Elle ne résiste jamais à une part de tarte.',
    item: 'Un rouleau à pâtisserie, redoutable.',
  },
  {
    name: 'Gontran',
    title: 'Ancien pigeon-messager',
    emoji: '🕊️',
    backstory: 'Il a livré mille messages sans jamais savoir les lire. Il connaît la ville par les toits.',
    stats: { force: 2, ruse: 4, esprit: 2, charme: 3 },
    pvMax: 7,
    ability: { name: 'Vol en rase-motte', text: 'Il passe partout par les toits, sans que personne ne le remarque.' },
    flaw: 'Il s’arrête pour picorer tout ce qui brille.',
    item: 'Une bague en plastique qu’il croit précieuse.',
  },
  {
    name: 'Vénus',
    title: 'Capitaine de flotte',
    emoji: '🚀',
    backstory: 'Elle a commandé trois vaisseaux, dont deux ont explosé avec amour. Elle veut le troisième.',
    stats: { force: 4, ruse: 3, esprit: 2, charme: 3 },
    pvMax: 9,
    ability: { name: 'Ordre de mission', text: 'Ses ordres sont obéis, même par les robots qui n’en ont pas envie.' },
    flaw: 'Elle parle comme si toute la galaxie l’écoutait.',
    item: 'Des jumelles de la flotte, un peu rayées.',
  },
  {
    name: 'Caramel',
    title: 'Chat détective',
    emoji: '🐈',
    backstory: 'Il mène ses enquêtes depuis le rebord des fenêtres, et exige son salaire en croquettes.',
    stats: { force: 1, ruse: 5, esprit: 3, charme: 3 },
    pvMax: 6,
    ability: { name: 'Pattes de velours', text: 'Il arrive partout sans bruit, même là où personne ne devrait aller.' },
    flaw: 'Il s’endort au milieu des indices.',
    item: 'Une loupe de chat, accrochée à son collier.',
  },
];

/** Un ennemi de combat : sa défense est la difficulté à le toucher, ses dégâts sont ceux de sa riposte. */
const foe = (draft: EnemyDraft): EnemyDraft => draft;

const ARCS: Arc[] = [
  {
    world: {
      title: 'Les Brumes de Valmoret',
      intro:
        'Une ville suspendue au-dessus d’un lac de brouillard. Chaque nuit, une rue disparaît, et avec elle ceux qui y vivaient.',
      goal: 'Retrouver la clé du lac avant que la brume n’efface la place du marché.',
      secret: 'La brume est le souffle d’un géant endormi sous le lac, qui avale les rues pour rester éveillé.',
    },
    npcs: [
      {
        name: 'Madame Orme',
        title: 'Gardienne du phare',
        emoji: '🕯️',
        attitude: 'Veut sauver sa rue. Méfiante, elle ne parle qu’en échange d’un service.',
      },
      {
        name: 'Jules',
        title: 'Enfant des pavés',
        emoji: '🧒',
        attitude: 'Cherche sa mère, disparue avec sa maison. Craintif, mais il voit tout.',
      },
      {
        name: 'Le Maître des Ponts',
        title: 'Notable du quartier haut',
        emoji: '🎩',
        attitude: 'Veut la clé pour lui. Il ne cède qu’à un pari ou à un bon marché.',
      },
    ],
    scenes: [
      {
        title: 'La rue qui s’efface',
        text: 'Au matin, la rue des Lanternes n’est plus là : des pavés lisses, une porte qui s’ouvre sur du brouillard. Un murmure sort de la brume et réclame de l’aide.',
        choices: [
          {
            label: 'Suivre le murmure à travers la brume',
            stat: 'esprit',
            difficulty: 10,
            onSuccess: 'Le murmure vous guide jusqu’à Jules, un enfant qui serre une lanterne éteinte.',
            onFailure: 'Vous tournez longtemps dans le brouillard, puis Jules vous rejoint de lui-même, un peu perdu.',
          },
          {
            label: 'Fouiller les décombres de la rue',
            stat: 'ruse',
            difficulty: 9,
            onSuccess: 'Sous les pavés, vous trouvez une carte de la ville : le lac y est entouré d’une croix.',
            onFailure: 'Vous ne trouvez qu’un vieux chapeau, mais aussi des traces de pas qui mènent vers le lac.',
          },
        ],
      },
      {
        title: 'Le phare de Madame Orme',
        text: 'Un phare au bord de la brume, dont la lampe ne s’allume plus. Madame Orme ferme sa porte à double tour, puis la rouvre juste assez pour parler.',
        npc: {
          name: 'Madame Orme',
          title: 'Gardienne du phare',
          emoji: '🕯️',
          attitude: 'Veut sauver sa rue. Méfiante, elle ne parle qu’en échange d’un service.',
          line: 'Vous voulez traverser la brume ? Alors aidez-moi d’abord : ma lampe ne s’allume plus.',
        },
        choices: [
          {
            label: 'Réparer la lampe',
            stat: 'esprit',
            difficulty: 11,
            onSuccess:
              'La lampe s’allume et trace un chemin dans le brouillard. Madame Orme vous confie sa clé de barque.',
            onFailure: 'La lampe chauffe, puis tombe. Madame Orme rit, et vous indique un passage par les toits.',
          },
          {
            label: 'Lui demander qui détient la clé du lac',
            stat: 'charme',
            difficulty: 12,
            onSuccess: 'Elle lâche un nom : le Maître des Ponts a acheté la clé à un pêcheur.',
            onFailure:
              'Elle refuse de parler, mais laisse échapper que le Maître des Ponts a racheté la clé à un pêcheur.',
          },
        ],
      },
      {
        title: 'Le gardien de la rue Noire',
        text: 'Une silhouette de brume se dresse au milieu de la rue, les bras tendus. Elle ne laissera personne passer vers le lac.',
        enemy: foe({
          name: 'Gardien de brume',
          title: 'Pantin de vapeur',
          emoji: '🌫️',
          intro: 'Une silhouette de brume bloque la rue, les bras tendus. Elle ne laissera personne passer.',
          hp: 7,
          defense: 10,
          damage: 2,
          onVictory: 'La silhouette se dissout en un ruban de brume, et la rue reprend un peu de couleur.',
        }),
        choices: [],
      },
      {
        title: 'Le pont des murmures',
        text: 'Le Maître des Ponts vous attend sur un pont de bois qui gémit à chaque pas. Il vous tend une balance et sourit : « Un pari. Traversez sans un mot, et la clé est à vous. »',
        npc: {
          name: 'Le Maître des Ponts',
          title: 'Notable du quartier haut',
          emoji: '🎩',
          attitude: 'Veut la clé pour lui. Il ne cède qu’à un pari ou à un bon marché.',
          line: 'Un pari, ou rien. Traversez sans un mot : c’est le prix de la clé.',
        },
        choices: [
          {
            label: 'Traverser en silence',
            stat: 'esprit',
            difficulty: 12,
            onSuccess: 'Le pont vous porte sans un craquement. Le Maître, impressionné, pose la clé dans votre main.',
            onFailure:
              'Un éternuement brise le silence : le pont se replie, la clé glisse, et Jules la rattrape au vol.',
          },
          {
            label: 'Proposer un échange',
            stat: 'charme',
            difficulty: 11,
            onSuccess: 'Il accepte de vous prêter la clé pour une nuit, contre la promesse de la rapporter.',
            onFailure: 'Il se moque de vous, mais une carte tombe de sa poche : elle indique le centre du lac.',
          },
        ],
      },
      {
        title: 'La cloche du lac',
        text: 'Au bord du lac, une cloche de fer sonne dans le brouillard. Chaque coup fait disparaître une rue de plus, et la brume vous entoure.',
        choices: [
          {
            label: 'Retenir le battant de la cloche',
            stat: 'force',
            difficulty: 12,
            onSuccess: 'Vous retenez le battant. La brume recule d’un pas, et révèle une plate-forme de pierre.',
            onFailure: 'La cloche vous renverse, mais son battant se coince : le son s’arrête un instant.',
          },
          {
            label: 'Compter les coups pour trouver la pause',
            stat: 'esprit',
            difficulty: 11,
            onSuccess: 'Entre deux coups, un passage s’ouvre vers le fond du lac.',
            onFailure: 'Vous perdez le compte, mais la brume s’épuise un moment et laisse voir le fond du lac.',
          },
        ],
      },
      {
        title: 'Le réveil du géant',
        text: 'Le lac se soulève : un géant de brume émerge, les yeux pleins de lumière. Autour de vous, la rue la plus proche commence à s’effacer.',
        enemy: foe({
          name: 'Le Géant de brume',
          title: 'Gardien du lac',
          emoji: '🌀',
          intro: 'Le géant se dresse au-dessus du lac. Chaque pas efface une maison.',
          hp: 12,
          defense: 12,
          damage: 3,
          onVictory: 'Le géant replonge dans le lac, et la brume se déchire sur le ciel de Valmoret.',
        }),
        choices: [],
      },
    ],
    victory: {
      title: 'Le ciel de Valmoret',
      text: 'La brume se retire lentement, et la place du marché retrouve ses étals. Madame Orme allume son phare, Jules court retrouver sa mère, et la clé du lac reste à la ville.',
    },
    defeat: {
      title: 'La rue disparue',
      text: 'La brume referme ses bras sur les dernières lanternes. Dans un an, personne ne se souviendra de cette rue, sauf les enfants qui se réveillent en chuchotant son nom.',
    },
  },
  {
    world: {
      title: 'Le Carnaval de Port-Ébène',
      intro:
        'Pendant trois jours, tout le monde porte un masque, les statues comprises. Le maire a disparu avec la clé du trésor de la ville.',
      goal: 'Retrouver la clé du trésor et démasquer le coupable avant la fin du bal.',
      secret: 'Le maire s’est caché sous le masque du Roi-Corbeau pour voler le trésor pendant la fête.',
    },
    npcs: [
      {
        name: 'Colombine',
        title: 'Danseuse masquée',
        emoji: '🎭',
        attitude: 'Sait beaucoup de choses, mais ne parle qu’en dansant. Elle s’amuse à embrouiller les gens.',
      },
      {
        name: 'Le capitaine Rigaud',
        title: 'Chef de la garde',
        emoji: '👮',
        attitude: 'Zélé et soupçonneux. Il veut arrêter quelqu’un pour prouver son zèle.',
      },
      {
        name: 'Le Roi-Corbeau',
        title: 'Maître de la fête',
        emoji: '🐦',
        attitude: 'Masque d’oiseau et voix dorée. Il tient la ville par ses promesses.',
      },
    ],
    scenes: [
      {
        title: 'Le masque qui parle',
        text: 'Le premier soir du carnaval, une statue de la place vous tend un masque et murmure : « Le maire a volé la clé. Cherchez le clocher. »',
        choices: [
          {
            label: 'Essayer le masque pour voir ce qu’il montre',
            stat: 'esprit',
            difficulty: 10,
            onSuccess: 'Le masque vous montre le clocher : la clé y est accrochée, à côté d’un chapeau de maire.',
            onFailure: 'Le masque vous fait danser malgré vous, jusqu’au bal de Colombine qui vous glisse une piste.',
          },
          {
            label: 'Demander à la statue qui elle est',
            stat: 'charme',
            difficulty: 11,
            onSuccess: 'La statue avoue : elle était le gardien du trésor, transformé par le maire.',
            onFailure: 'La statue ne répond que par des proverbes, dont un parle d’un bal masqué.',
          },
        ],
      },
      {
        title: 'Le bal de Colombine',
        text: 'Sur la piste, tout le monde ment avec le sourire. Colombine vous tend la main, et son masque semble vous observer.',
        npc: {
          name: 'Colombine',
          title: 'Danseuse masquée',
          emoji: '🎭',
          attitude: 'Sait beaucoup de choses, mais ne parle qu’en dansant. Elle s’amuse à embrouiller les gens.',
          line: 'Sur la piste, tout le monde ment. Dansez avec moi, et je vous dirai qui.',
        },
        choices: [
          {
            label: 'Danser avec elle en écoutant',
            stat: 'charme',
            difficulty: 10,
            onSuccess: 'Pendant la valse, elle glisse : le Roi-Corbeau tient les gardes sous sa coupe.',
            onFailure:
              'Vous marchez sur ses pieds. Elle rit, puis vous glisse un indice : le Roi-Corbeau porte un bracelet d’or.',
          },
          {
            label: 'Suivre les masques silencieux',
            stat: 'ruse',
            difficulty: 12,
            onSuccess: 'Vous suivez un masque qui se dirige vers la tour de l’horloge.',
            onFailure: 'Un garde vous repère et vous escorte, de gré ou de force, vers la tour de l’horloge.',
          },
        ],
      },
      {
        title: 'Les gardes du capitaine',
        text: 'Au pied de la tour de l’horloge, le capitaine Rigaud vous barre la route, sabre au clair : « Au nom du maire, on arrête tout le monde ! »',
        npc: {
          name: 'Le capitaine Rigaud',
          title: 'Chef de la garde',
          emoji: '👮',
          attitude: 'Zélé et soupçonneux. Il veut arrêter quelqu’un pour prouver son zèle.',
          line: 'Au nom du maire, personne ne passe. Rendez-vous, ou je frappe !',
        },
        enemy: foe({
          name: 'Capitaine Rigaud',
          title: 'Chef de la garde',
          emoji: '👮',
          intro: 'Le capitaine vous barre la route. « Au nom du maire, on arrête tout le monde ! »',
          hp: 8,
          defense: 11,
          damage: 2,
          onVictory: 'Le capitaine se relève, penaud, et lâche un trousseau de clés dans la poussière.',
        }),
        choices: [],
      },
      {
        title: 'La tour de l’horloge',
        text: 'Au sommet de la tour, le Roi-Corbeau surveille la fête, un coffre sous ses pieds. Il vous fait signe d’approcher, sans quitter son masque d’oiseau.',
        npc: {
          name: 'Le Roi-Corbeau',
          title: 'Maître de la fête',
          emoji: '🐦',
          attitude: 'Masque d’oiseau et voix dorée. Il tient la ville par ses promesses.',
          line: 'Votre place est parmi mes sujets masqués. Ou sous le pavé.',
        },
        choices: [
          {
            label: 'Feindre l’allégeance',
            stat: 'ruse',
            difficulty: 12,
            onSuccess:
              'Il vous confie la clé pour vérifier votre loyauté. Un détail : elle porte le sceau de la mairie.',
            onFailure: 'Il devine le mensonge, mais un coup de vent emporte son masque : il est bien le maire.',
          },
          {
            label: 'Le défier en paroles',
            stat: 'esprit',
            difficulty: 13,
            onSuccess: 'Vos mots le déstabilisent. Il laisse tomber la clé, et la foule commence à murmurer.',
            onFailure: 'Il éclate de rire et ordonne à ses gardes de vous conduire au centre de la place.',
          },
        ],
      },
      {
        title: 'Le duel masqué',
        text: 'Le masque d’oiseau s’arrache : le maire, furieux, dégaine une épée de parade. Ses gardes accourent au bruit de la lame.',
        npc: {
          name: 'Le Roi-Corbeau',
          title: 'Maître de la fête',
          emoji: '🐦',
          attitude: 'Masque d’oiseau et voix dorée. Il tient la ville par ses promesses.',
          line: 'Vous ne savez pas à qui vous parlez. Je suis la loi de cette ville !',
        },
        enemy: foe({
          name: 'Le maire déguisé',
          title: 'Roi-Corbeau',
          emoji: '🐦',
          intro: 'Le maire, furieux, dégaine son épée de parade. Ses gardes arrivent au pas de course.',
          hp: 12,
          defense: 12,
          damage: 2,
          onVictory: 'Le maire tombe, et son masque reste accroché à la rambarde de la tour.',
        }),
        choices: [],
      },
      {
        title: 'Le dénouement du carnaval',
        text: 'Minuit sonne. La clé est entre vos mains, et la place attend le discours du maire. Il faut rendre le trésor avant que le bal ne se termine.',
        choices: [
          {
            label: 'Rapporter la clé en plein bal',
            stat: 'charme',
            difficulty: 11,
            onSuccess: 'La foule applaudit : le trésor retourne à la ville, et le maire n’a plus où se cacher.',
            onFailure: 'La foule hésite, puis Colombine se met à danser avec la clé, et tout le monde la suit.',
          },
          {
            label: 'Ouvrir le coffre en secret',
            stat: 'ruse',
            difficulty: 13,
            onSuccess: 'Le coffre s’ouvre sur les médailles et les chapeaux : la ville est sauvée, sans bruit.',
            onFailure: 'Le coffre grince bruyamment, et toute la place se tourne vers vous.',
          },
        ],
      },
    ],
    victory: {
      title: 'Le dernier bal',
      text: 'Le trésor revient à la ville, les masques tombent un à un, et le carnaval se termine dans les rires. On raconte encore, dans les tavernes, la nuit où le maire a dansé sans son chapeau.',
    },
    defeat: {
      title: 'Le carnaval continue',
      text: 'Le trésor disparaît sous un nouveau masque, et la fête reprend comme si de rien n’était. Les statues de la place, elles, ne clignent plus jamais des yeux.',
    },
  },
  {
    world: {
      title: 'La Forêt qui Chuchote',
      intro:
        'Les arbres parlent, mais jamais deux fois de la même chose. Un enfant a été emporté par une racine trop curieuse.',
      goal: 'Retrouver Noé, emporté sous la mousse, et refermer la brèche de la forêt.',
      secret:
        'L’arbre-mère ne peut se rendormir qu’avec une histoire partagée par plusieurs voix. Les racines enlèvent les gens qui n’en ont pas.',
    },
    npcs: [
      {
        name: 'Noé',
        title: 'Enfant des bois',
        emoji: '🧒',
        attitude: 'Emporté par une racine. Il ne sait plus son chemin, mais il entend ce que disent les arbres.',
      },
      {
        name: 'Brigitte',
        title: 'Garde-forestière',
        emoji: '🌿',
        attitude: 'Connaît chaque sentier et refuse de couper un arbre. Méfiante envers les étrangers.',
      },
      {
        name: 'Sapinette',
        title: 'Renarde pirate',
        emoji: '🦊',
        attitude: 'Cherche un trésor enfoui sous l’arbre. Prête à trahir pour lui, à condition d’être payée.',
      },
      {
        name: 'Théo',
        title: 'Gardien des livres',
        emoji: '📚',
        attitude: 'A lu la légende de l’arbre-mère. Il sait qu’il faut être nombreux pour la réveiller.',
      },
    ],
    scenes: [
      {
        title: 'La racine curieuse',
        text: 'Un matin, une racine a fait disparaître Noé dans la mousse. Les arbres chuchotent son nom, sans jamais répéter la même phrase.',
        choices: [
          {
            label: 'Creuser à l’endroit où elle a disparu',
            stat: 'force',
            difficulty: 10,
            onSuccess: 'Vous dégagez la mousse et découvrez un tunnel de racines qui descend vers le sud.',
            onFailure:
              'La terre s’effondre. Vous êtes tiré hors du trou, mais une trace de pas minuscules mène vers le sud.',
          },
          {
            label: 'Écouter les chuchotements',
            stat: 'esprit',
            difficulty: 11,
            onSuccess: 'Un chuchotement répète une phrase : « Elle est au cœur, près des vieux souvenirs. »',
            onFailure: 'Les arbres vous racontent cent histoires contradictoires, dont une parle d’une grotte au sud.',
          },
        ],
      },
      {
        title: 'La garde-forestière',
        text: 'Brigitte se tient entre deux troncs, une main sur un sifflet d’appel. Derrière elle, le sentier se perd dans les racines.',
        npc: {
          name: 'Brigitte',
          title: 'Garde-forestière',
          emoji: '🌿',
          attitude: 'Connaît chaque sentier et refuse de couper un arbre. Méfiante envers les étrangers.',
          line: 'Vous ne couperez pas un arbre ici. Si vous voulez passer, parlez-leur d’abord.',
        },
        choices: [
          {
            label: 'Demander à Brigitte de vous guider',
            stat: 'charme',
            difficulty: 10,
            onSuccess: 'Brigitte accepte : elle connaît un sentier qui évite les racines les plus affamées.',
            onFailure: 'Brigitte refuse, mais laisse son sifflet sur un tronc : les animaux vous guideront.',
          },
          {
            label: 'Trouver le sentier sans elle',
            stat: 'ruse',
            difficulty: 12,
            onSuccess: 'Vous repérez les marques des cerfs et évitez un piège de racines.',
            onFailure: 'Vous vous perdez, mais une biche vous ramène sur la bonne piste.',
          },
        ],
      },
      {
        title: 'Les racines affamées',
        text: 'Une racine se dresse hors de la terre, couverte de nœuds qui ressemblent à des visages. Elle se jette sur vous sans prévenir.',
        enemy: foe({
          name: 'Racine affamée',
          title: 'Racine enragée',
          emoji: '🪵',
          intro: 'Une racine se dresse et se jette sur vous. Ses nœuds ressemblent à des visages.',
          hp: 8,
          defense: 11,
          damage: 2,
          onVictory: 'La racine se rétracte dans la terre en laissant tomber un bout de ruban : celui de Noé.',
        }),
        choices: [],
      },
      {
        title: 'Le passage de la renarde',
        text: 'Sapinette sort de l’ombre, un sourire en biais. Elle connaît un passage secret, et elle veut bien le vendre.',
        npc: {
          name: 'Sapinette',
          title: 'Renarde pirate',
          emoji: '🦊',
          attitude: 'Cherche un trésor enfoui sous l’arbre. Prête à trahir pour lui, à condition d’être payée.',
          line: 'Un trésor, ça ne se partage pas. Mais ça se négocie.',
        },
        choices: [
          {
            label: 'Négocier avec la renarde',
            stat: 'charme',
            difficulty: 11,
            onSuccess: 'Elle accepte de vous montrer le passage, contre la promesse de partager le trésor.',
            onFailure: 'Elle s’enfuit, mais laisse tomber une carte à demi effacée qui indique le cœur de la forêt.',
          },
          {
            label: 'La suivre sans bruit',
            stat: 'ruse',
            difficulty: 12,
            onSuccess: 'Elle vous mène jusqu’à une clairière où l’arbre-mère respire lentement.',
            onFailure: 'Elle vous repère et vous attire dans un piège de feuilles, d’où l’arbre-mère vous observe.',
          },
        ],
      },
      {
        title: 'Le cœur de la forêt',
        text: 'Au centre de la forêt, un arbre immense ouvre une bouche d’écorce. Il demande une histoire en échange de la vérité.',
        npc: {
          name: 'Théo',
          title: 'Gardien des livres',
          emoji: '📚',
          attitude: 'A lu la légende de l’arbre-mère. Il sait qu’il faut être nombreux pour la réveiller.',
          line: 'Chaque racine veut une histoire. Donnez-lui une vraie, et elle vous rendra Noé.',
        },
        choices: [
          {
            label: 'Raconter un souvenir heureux',
            stat: 'charme',
            difficulty: 9,
            onSuccess: 'L’arbre frémit et rend le ruban de Noé. La brèche de la forêt se referme un peu.',
            onFailure:
              'Votre souvenir sonne faux, et l’arbre se tait. Théo, touché, raconte alors le sien, et l’arbre écoute.',
          },
          {
            label: 'Chercher la légende dans les livres',
            stat: 'esprit',
            difficulty: 12,
            onSuccess: 'Théo retrouve la légende : l’arbre dort si plusieurs voix racontent une même histoire.',
            onFailure: 'Les pages sont abîmées. Théo se souvient seulement qu’il faut être nombreux pour réussir.',
          },
        ],
      },
      {
        title: 'L’arbre-mère',
        text: 'Le tronc s’ouvre en deux. Des branches se tendent vers Noé, suspendu au milieu des racines, et la forêt retient son souffle.',
        enemy: foe({
          name: 'L’Arbre-mère',
          title: 'Gardien endormi',
          emoji: '🌳',
          intro: 'Le tronc s’ouvre. Des branches se tendent vers Noé, suspendu au milieu des racines.',
          hp: 12,
          defense: 12,
          damage: 3,
          onVictory: 'Les branches se referment doucement. Noé tombe dans vos bras, et la forêt se tait enfin.',
        }),
        choices: [],
      },
    ],
    victory: {
      title: 'Le silence des arbres',
      text: 'Noé revient, un peu décoiffé et très fier d’avoir été le premier à entendre l’arbre-mère. La forêt ne chuchote plus, et le sentier vers le village reste ouvert.',
    },
    defeat: {
      title: 'Les voix de la forêt',
      text: 'La forêt garde Noé et chuchote son nom le soir, pour que personne ne l’oublie. Les villageois ne s’aventurent plus sous les arbres.',
    },
  },
  FROMAGERIE_ARC,
  PIGEONS_ARC,
  VAISSEAU_ARC,
];

/** Scènes de secours pour une histoire venue de l’IA : à défaut d’intrigue écrite, elles restent sobres et ne citent aucun nom. */
const GENERIC_SCENES: SceneSeed[] = [
  {
    title: 'Un chemin qui se divise',
    text: 'Le chemin se sépare en deux. Au loin, on entend des voix, et le vent porte une odeur de fumée.',
    choices: [
      {
        label: 'Suivre les voix',
        stat: 'ruse',
        difficulty: 10,
        onSuccess: 'Les voix mènent à un vieux compagnon de route, qui connaît la suite du voyage.',
        onFailure: 'Les voix se taisent, mais le chemin vous conduit quand même au point suivant.',
      },
      {
        label: 'Couper à travers champs',
        stat: 'force',
        difficulty: 11,
        onSuccess: 'Vous coupez court et gagnez une bonne avance sur le danger.',
        onFailure: 'Vous vous égarez, puis retrouvez la trace du chemin, un peu plus loin.',
      },
    ],
  },
  {
    title: 'Le bandit du passage',
    text: 'Un bandit masqué barre le passage, la main sur le manche de son couteau. Il lance un défi sans détour.',
    enemy: {
      name: 'Bandit des chemins',
      title: 'Coupe-bourse',
      emoji: '🦹',
      intro: 'Un bandit masqué barre le passage, couteau en main.',
      hp: 7,
      defense: 10,
      damage: 2,
      onVictory: 'Le bandit s’enfuit en laissant tomber une carte froissée.',
    },
    choices: [],
  },
  {
    title: 'Une lueur entre les arbres',
    text: 'Le groupe s’arrête pour souffler. Quelqu’un remarque une lueur entre les arbres, qui vacille comme une lanterne.',
    choices: [
      {
        label: 'Aller voir de plus près',
        stat: 'esprit',
        difficulty: 10,
        onSuccess: 'La lueur vient d’un abri où l’on vous offre un repas et une information utile.',
        onFailure: 'La lueur s’éteint à votre approche, mais vous trouvez des traces qui mènent plus loin.',
      },
      {
        label: 'Rester prudent et attendre',
        stat: 'ruse',
        difficulty: 11,
        onSuccess: 'Une silhouette sort de l’ombre et vous montre le bon chemin, sans un mot.',
        onFailure: 'Rien ne vient. Quand vous repartez, la route semble plus claire qu’avant.',
      },
    ],
  },
];

const GENERIC_VICTORY: EpilogueDraft = {
  title: 'Le bout du chemin',
  text: 'Le groupe arrive enfin au bout de son voyage, fourbu mais uni. Les histoires de cette aventure seront racontées longtemps au coin du feu.',
};

/** Complète une scène de secours : son type se déduit de son contenu quand l’intrigue ne le précise pas. */
function normalizeScene(seed: SceneSeed): SceneDraft {
  const kind = seed.kind ?? (seed.enemy ? 'combat' : seed.npc ? 'dialogue' : 'choix');
  return sceneDraftSchema.parse({ ...seed, kind });
}

/** Intrigue associée à chaque thème du catalogue. Un thème libre tire une intrigue au hasard. */
export const THEME_ARC: Readonly<Record<string, number>> = {
  brumes: 0,
  carnaval: 1,
  foret: 2,
  fromagerie: 3,
  pigeons: 4,
  vaisseau: 5,
};

const GENERIC_DEFEAT: EpilogueDraft = {
  title: 'Une retraite honorable',
  text: 'Rien ne s’est passé comme prévu, mais chacun est reparti sur ses jambes. Parfois, la plus grande aventure est de savoir quand partir.',
};

/** Tire `count` éléments distincts d’une réserve, avec le générateur injecté. */
function pickDistinct<T>(pool: readonly T[], count: number, random: () => number): T[] {
  const left = [...pool];
  const out: T[] = [];
  while (out.length < count && left.length > 0) {
    const index = Math.floor(random() * left.length);
    out.push(left.splice(index, 1)[0]!);
  }
  return out;
}

/** Une aventure de secours : son monde, ses personnages secondaires, et l’indice de l’intrigue choisie (null pour une histoire de l’IA). */
export function fallbackRoster(
  random: () => number,
  themeKey: string | null = null,
): { roster: RosterDraft; arc: number } {
  const mapped = themeKey !== null ? THEME_ARC[themeKey] : undefined;
  const arc = mapped ?? Math.floor(random() * ARCS.length);
  const chosen = ARCS[arc]!;
  return {
    arc,
    roster: {
      world: chosen.world,
      npcs: chosen.npcs,
      characters: pickDistinct(CHARACTERS, 6, random),
    },
  };
}

/** Scène n° `sceneNumber` sur `total`. Dans une intrigue écrite, elle suit l’ordre de l’histoire. */
export function fallbackScene(
  random: () => number,
  arc: number | null,
  sceneNumber: number,
  total: number,
  usedTitles: readonly string[],
): SceneDraft {
  if (arc !== null && ARCS[arc]) {
    const picks = SCENE_PICKS[total] ?? SCENE_PICKS[4]!;
    const index = picks[Math.min(sceneNumber, picks.length) - 1] ?? 0;
    return normalizeScene(ARCS[arc]!.scenes[index]!);
  }
  const fresh = GENERIC_SCENES.filter((s) => !usedTitles.includes(s.title));
  return normalizeScene(pickDistinct(fresh.length > 0 ? fresh : GENERIC_SCENES, 1, random)[0]!);
}

export function fallbackEpilogue(arc: number | null, victory: boolean): EpilogueDraft {
  const chosen = arc !== null ? ARCS[arc] : undefined;
  if (victory) return chosen?.victory ?? GENERIC_VICTORY;
  return chosen?.defeat ?? GENERIC_DEFEAT;
}

/** Pour les tests : toutes les scènes de secours, écrites à la main (intrigues et réserve générique). */
export const FALLBACK_SCENES: readonly SceneSeed[] = [...ARCS.flatMap((a) => a.scenes), ...GENERIC_SCENES];
/** Pour les tests : les intrigues de secours, avec leurs personnages secondaires. */
export const FALLBACK_ARCS = ARCS.map((a) => ({ world: a.world, npcs: a.npcs, scenes: a.scenes }));
export const FALLBACK_SCENE_PICKS = SCENE_PICKS;

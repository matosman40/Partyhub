import type { FallbackArc } from './fallback-arc.js';

/** Intrigue de secours « Vaisseau rétro » : un vaisseau des années 1950, un capitaine holographique, une radio qui décide du cap. */
export const VAISSEAU_ARC: FallbackArc = {
  world: {
    title: 'L’Étoile Caramel',
    intro:
      'Le vaisseau Étoile Caramel, né en 1957 dans un magazine, a oublié sa destination. Son capitaine est un hologramme qui hésite, et sa cantine est tenue par un robot qui ne sait faire que des tartes.',
    goal: 'Retrouver la route de la Terre avant que les réserves de cacao spatial ne tombent à zéro.',
    secret:
      'Le cap est donné par une vieille radio qui capte un feuilleton. Le dernier épisode n’a jamais été diffusé, et c’est pour cela que le vaisseau tourne en rond.',
  },
  npcs: [
    {
      name: 'Capitaine Vega',
      title: 'Capitaine holographique',
      emoji: '👨‍🚀',
      attitude:
        'Charismatique, mais il s’efface dès qu’on lui pose une question précise. Il ne donne ses ordres qu’à ceux qui les méritent.',
    },
    {
      name: 'Cantinor',
      title: 'Chef robot de la cantine',
      emoji: '🤖',
      attitude:
        'Ne parle qu’en recettes. Il réclame du cacao spatial, et menace de geler le vaisseau si personne n’en rapporte.',
    },
    {
      name: 'Radio-Rétro',
      title: 'Navigateur à lampes',
      emoji: '📻',
      attitude:
        'Capte un vieux feuilleton et ne donne son cap qu’à ceux qui écoutent jusqu’au bout. Elle grésille quand on la contredit.',
    },
  ],
  scenes: [
    {
      kind: 'choix',
      title: 'Réveil en pyjama d’argent',
      text: 'Les lampes du vaisseau s’allument une à une. Un message grésille sur l’écran : « Bienvenue à bord. Ne touchez pas au grand levier rouge. » Le levier a déjà été touché.',
      choices: [
        {
          label: 'Lire les instructions affichées au tableau',
          stat: 'esprit',
          difficulty: 10,
          onSuccess: 'Le tableau indique le cap : un point nommé « Terre, version 1957 ».',
          onFailure: 'Le texte est écrit tout petit, à côté d’un dessin de soucoupe volante.',
          risk: 1,
        },
        {
          label: 'Actionner le levier rouge avec prudence',
          stat: 'force',
          difficulty: 11,
          onSuccess: 'Le levier libère un tiroir où dort un casque à antennes, qui fredonne une chanson.',
          onFailure: 'Le levier fait sauter les lumières. Le vaisseau se met à jouer une marche militaire.',
          item: 'Un casque à antennes qui fredonne',
          risk: 2,
        },
      ],
    },
    {
      kind: 'dialogue',
      title: 'Le capitaine s’efface',
      text: 'Une silhouette lumineuse se forme au centre du pont. Le capitaine Vega sourit, un peu flou, et lève la main pour vous saluer.',
      npc: {
        name: 'Capitaine Vega',
        title: 'Capitaine holographique',
        emoji: '👨‍🚀',
        attitude:
          'Charismatique, mais il s’efface dès qu’on lui pose une question précise. Il ne donne ses ordres qu’à ceux qui les méritent.',
        line: 'Vous voulez la Terre ? Je vous la décrirais bien, mais je ne la vois plus très nettement.',
      },
      choices: [
        {
          label: 'Lui demander ce qu’il voit encore',
          stat: 'esprit',
          difficulty: 10,
          onSuccess: 'Il décrit un jardin bleu, et vous sentez une nostalgie partagée qui vous rapproche.',
          onFailure: 'Il répond que la question est mal posée, puis disparaît un instant.',
          risk: 0,
          bond: 1,
        },
        {
          label: 'Lui dire que la Terre n’existe peut-être plus',
          stat: 'charme',
          difficulty: 11,
          onSuccess: 'Il pâlit, puis confie la vérité : le navigateur est une radio qui capte un feuilleton.',
          onFailure: 'Il se vexe et coupe la lumière du poste de pilotage pendant une minute.',
          risk: 1,
          bond: -1,
        },
      ],
    },
    {
      kind: 'enigme',
      title: 'La radio capricieuse',
      text: 'La radio du navigateur grésille. Elle ne donne le cap que si l’on répond à une question de feuilleton : « Qui a volé le collier de la reine Ondine dans le dernier épisode ? »',
      hint: 'Le feuilleton s’appelait « Les Mystères du Cosmos », et le méchant portait toujours un chapeau.',
      choices: [
        {
          label: 'Répondre : le baron au chapeau',
          stat: 'esprit',
          difficulty: 11,
          onSuccess: 'La radio crépite et lâche le cap : « Terre, troisième orbite ».',
          onFailure: 'La radio répond : « Faux, comme toujours ! » et se tait pendant dix minutes.',
          item: 'Un épisode dédicacé du feuilleton',
          risk: 1,
        },
        {
          label: 'Brancher la radio sur la batterie du frigo',
          stat: 'ruse',
          difficulty: 10,
          onSuccess: 'La radio s’allume, et donne le cap après un petit discours du speaker.',
          onFailure: 'Le frigo se met à grincer, puis lâche une bouffée de glace sur tout le pont.',
          risk: 2,
        },
      ],
    },
    {
      kind: 'halte',
      title: 'Un goûter à la cantine',
      text: 'La cantine du vaisseau sert une tarte aux fruits. Le robot cuisinier vous présente le plateau, et ses bras articulés tremblent d’émotion.',
      npc: {
        name: 'Cantinor',
        title: 'Chef robot de la cantine',
        emoji: '🤖',
        attitude:
          'Ne parle qu’en recettes. Il réclame du cacao spatial, et menace de geler le vaisseau si personne n’en rapporte.',
        line: 'Mangez, mangez ! Mais sachez que, sans cacao spatial, je ne ferai plus rien.',
      },
      choices: [
        {
          label: 'Goûter la tarte et complimenter le robot',
          stat: 'charme',
          difficulty: 9,
          onSuccess: 'Le robot rougit de tous ses circuits, et vous offre une seconde part.',
          onFailure: 'La tarte est un peu trop salée. Le robot pleure de la vapeur, mais vous restez poli.',
          heal: 2,
          risk: 0,
          bond: 1,
        },
        {
          label: 'Se reposer près du hublot',
          stat: 'esprit',
          difficulty: 9,
          onSuccess: 'Une étoile dans le hublot ressemble à une boule à facettes. Vous reprenez votre souffle.',
          onFailure: 'Une vibration vous réveille : le vaisseau a changé de cap sans prévenir.',
          heal: 2,
          risk: 1,
        },
      ],
    },
    {
      kind: 'combat',
      title: 'La soute au cacao',
      text: 'La soute au cacao est gardée par un robot aux bras à ventouses. Il ne laisse passer personne sans ticket de cantine, et il n’en a pas non plus.',
      enemy: {
        name: 'Gardien de la soute',
        title: 'Robot à ventouses',
        emoji: '🤖',
        intro: 'Un robot à ventouses bloque la soute, où dort le cacao spatial. Ses yeux rouges clignotent.',
        hp: 10,
        defense: 12,
        damage: 2,
        onVictory: 'Le robot s’éteint dans un bip satisfait, et la soute s’ouvre sur des sacs de cacao étincelant.',
        loot: 'Un sachet de cacao spatial',
      },
    },
    {
      kind: 'choix',
      title: 'Le cap sur la Terre',
      text: 'Le vaisseau tremble, les lampes clignotent, et la radio annonce enfin une destination : une planète bleue, à trois minutes. Il faut la rejoindre avant que le cacao ne fonde.',
      choices: [
        {
          label: 'Piloter manuellement vers la planète bleue',
          stat: 'ruse',
          difficulty: 12,
          onSuccess: 'Vous posez le vaisseau dans une prairie, parfaitement alignée sur une station-service.',
          onFailure: 'Vous atterrissez en travers d’une fête de village. Les habitants applaudissent.',
          risk: 1,
        },
        {
          label: 'Laisser le capitaine Vega piloter',
          stat: 'charme',
          difficulty: 11,
          onSuccess: 'Le capitaine retrouve sa voix, et le vaisseau atterrit dans un ballet de fumée.',
          onFailure: 'Il entonne l’hymne de la flotte, et l’atterrissage devient un saut de cabri.',
          risk: 1,
        },
      ],
    },
  ],
  victory: {
    title: 'Atterrissage en prairie',
    text: 'L’Étoile Caramel se pose en douceur au milieu d’une prairie, et la radio diffuse enfin le dernier épisode du feuilleton. Le capitaine Vega retrouve ses contours, Cantinor ouvre une cantine en plein air, et le cacao spatial est partagé à tout le village.',
  },
  defeat: {
    title: 'Le vaisseau à la dérive',
    text: 'L’Étoile Caramel continue sa route, sans cap ni cacao, à travers un ciel en papier peint. Quelque part, la radio grésille encore le début d’un épisode qui ne finira jamais.',
  },
};

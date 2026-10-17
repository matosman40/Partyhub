import type { FallbackArc } from './fallback-arc.js';

/** Intrigue de secours « Fromagerie hantée » : des fromages qui parlent, une meule disparue, un concours à sauver. */
export const FROMAGERIE_ARC: FallbackArc = {
  world: {
    title: 'La Fromagerie de Val-Coulant',
    intro:
      'Dans le village de Val-Coulant, la fromagerie Bouchard est hantée : les fromages murmurent, réclament des caresses et se vexent quand on les oublie. Cette nuit, la Meule d’Or, fromage fondateur du village, a disparu de sa cave fermée à clé.',
    goal: 'Retrouver la Meule d’Or avant le concours fromager de dimanche, sans froisser les fromages.',
    secret:
      'La Meule d’Or ne veut pas être primée : elle a découvert que le concours la mènera à la fondue. Elle se cache sous le faux plancher de la cave.',
  },
  npcs: [
    {
      name: 'Madame Bouchard',
      title: 'Fromagère en chef',
      emoji: '👵',
      attitude:
        'Veut sauver la réputation de la maison. Elle croit que les fromages lui parlent, et elle n’a pas forcément tort.',
    },
    {
      name: 'Le Comte de Brie',
      title: 'Juge du concours',
      emoji: '🎩',
      attitude:
        'Gourmet pompeux. Il ne cède qu’à un plateau de bons morceaux, ou à une devinette de palais bien tournée.',
    },
    {
      name: 'Ferdinand',
      title: 'Apprenti fromager',
      emoji: '🧑‍🍳',
      attitude: 'Paniqué, il a vu quelqu’un entrer dans la cave. Il craint qu’on l’accuse, à tort, du vol.',
    },
  ],
  scenes: [
    {
      kind: 'choix',
      title: 'Les fromages réclament',
      text: 'Dès l’aube, la fromagerie grince : une tomme pleure, un bleu boude, et le reblochon exige des excuses. La cave, elle, est fermée à double tour, et son odeur de lavande sort par la serrure.',
      choices: [
        {
          label: 'Caresser les fromages un par un',
          stat: 'charme',
          difficulty: 9,
          onSuccess: 'Les tommes ronronnent et lâchent un indice : la Meule sentait la lavande.',
          onFailure: 'Vous en caressez un trop fort : il se vexe, et une clé tombe sous le comptoir.',
          item: 'Une clé de cave couverte de moisissure',
          risk: 1,
        },
        {
          label: 'Inspecter la serrure de la cave',
          stat: 'ruse',
          difficulty: 11,
          onSuccess: 'La serrure a été forcée avec une pince à fromage : quelqu’un de petit, et de pressé.',
          onFailure:
            'La porte claque et vous restez enfermé avec une meule en colère. Vous en sortez couvert de croûte.',
          risk: 2,
        },
      ],
    },
    {
      kind: 'dialogue',
      title: 'Ferdinand, la main qui tremble',
      text: 'Ferdinand se cache derrière une pile de caisses de comté. Il vous voit, sursaute, puis chuchote qu’il a tout vu.',
      npc: {
        name: 'Ferdinand',
        title: 'Apprenti fromager',
        emoji: '🧑‍🍳',
        attitude: 'Paniqué, il a vu quelqu’un entrer dans la cave. Il craint qu’on l’accuse, à tort, du vol.',
        line: 'J’ai vu quelqu’un entrer dans la cave. Il sentait la lavande et il marchait comme un fromage qui a peur.',
      },
      choices: [
        {
          label: 'Lui promettre de garder son secret',
          stat: 'charme',
          difficulty: 9,
          onSuccess: 'Ferdinand avoue : la Meule lui a demandé de l’aider, contre un bon pour le concours.',
          onFailure: 'Il jure ne rien savoir, mais ses oreilles rougissent comme une tomme qui cuit.',
          risk: 0,
          bond: 1,
        },
        {
          label: 'Le menacer gentiment avec une louche',
          stat: 'force',
          difficulty: 10,
          onSuccess: 'Il avoue dans un bégaiement : la Meule voulait fuir le concours.',
          onFailure: 'Il crie, et toute la fromagerie se met à réclamer justice.',
          risk: 1,
          bond: -1,
        },
      ],
    },
    {
      kind: 'enigme',
      title: 'La porte de la cave',
      text: 'Une plaque de cuivre est vissée sur la porte, gravée d’une devinette : « Je suis faite de lait, et je ne suis pas du lait. Plus on me coupe, plus je grandis. Qui suis-je ? »',
      hint: 'On la trouve sur un plateau après le dîner, et elle mûrit dans le noir.',
      choices: [
        {
          label: 'Répondre à voix haute : le fromage',
          stat: 'esprit',
          difficulty: 10,
          onSuccess: 'La porte s’ouvre dans un déclic. Un bleu, vexé d’avoir été deviné si vite, vous salue poliment.',
          onFailure: 'La plaque rougit de honte, et la porte reste close. Il faudra forcer le passage.',
          item: 'Un petit morceau de Meule d’Or, séché',
          risk: 1,
        },
        {
          label: 'Forcer la porte avec une louche',
          stat: 'force',
          difficulty: 12,
          onSuccess: 'La porte cède. Derrière, la Meule d’Or dort sous une nappe à carreaux.',
          onFailure: 'La louche se plie, et la porte ne bouge pas. Votre dignité en prend un coup.',
          risk: 1,
        },
      ],
    },
    {
      kind: 'halte',
      title: 'Le goûter de Madame Bouchard',
      text: 'Pour vous remettre de la cave, Madame Bouchard dresse une dégustation sur la grande table. Le Comte de Brie est arrivé en palanquin, et il réclame déjà le premier morceau.',
      npc: {
        name: 'Madame Bouchard',
        title: 'Fromagère en chef',
        emoji: '👵',
        attitude:
          'Veut sauver la réputation de la maison. Elle croit que les fromages lui parlent, et elle n’a pas forcément tort.',
        line: 'Asseyez-vous et mangez un peu. Une fromagerie qui a faim n’enquête jamais bien.',
      },
      choices: [
        {
          label: 'Goûter un beaufort vieilli',
          stat: 'esprit',
          difficulty: 9,
          onSuccess:
            'Le beaufort vous raconte la légende de la Meule : elle rêve de la mer, et d’un ciel sans concours.',
          onFailure: 'Le goût est si fort que vous oubliez la moitié de ce que vous vouliez demander.',
          item: 'Un beaufort vieilli, en papier',
          heal: 2,
          risk: 0,
        },
        {
          label: 'Aider à faire la vaisselle',
          stat: 'charme',
          difficulty: 8,
          onSuccess: 'Madame Bouchard vous sourit et vous offre un morceau de sa meilleure tomme.',
          onFailure: 'La vaisselle vous glisse des mains. Madame Bouchard vous console avec un fromage frais.',
          heal: 1,
          risk: 0,
          bond: 1,
        },
      ],
    },
    {
      kind: 'combat',
      title: 'Le Comte garde la cave',
      text: 'Le Comte de Brie se place devant la porte de la cave, un sabre de cuisine à la main. Il estime que le concours doit avoir lieu, coûte que coûte.',
      npc: {
        name: 'Le Comte de Brie',
        title: 'Juge du concours',
        emoji: '🎩',
        attitude:
          'Gourmet pompeux. Il ne cède qu’à un plateau de bons morceaux, ou à une devinette de palais bien tournée.',
        line: 'Nul ne touche à la cave avant le jugement. Le concours doit avoir lieu !',
      },
      enemy: {
        name: 'Le Comte de Brie',
        title: 'Gardien de la cave',
        emoji: '🎩',
        intro: 'Le Comte bloque la porte, sabre de cuisine au poing. « Le concours aura lieu ! »',
        hp: 9,
        defense: 11,
        damage: 2,
        onVictory: 'Le Comte s’effondre dans un plateau de rillettes, et avoue que la Meule voulait juste partir.',
        loot: 'Un plateau de comté de collection',
      },
    },
    {
      kind: 'choix',
      title: 'La Meule au concours',
      text: 'La Meule d’Or est là, dans son panier de paille. Elle a l’air résignée, et un peu fière. Dimanche approche, et il faut décider de son sort.',
      choices: [
        {
          label: 'La ramener au concours',
          stat: 'charme',
          difficulty: 10,
          onSuccess: 'Le Comte goûte, s’étouffe de bonheur et proclame la Meule la plus noble du canton.',
          onFailure:
            'La Meule refuse d’être fondue. Madame Bouchard la sort elle-même du panier, et la ramène à la cave.',
          risk: 0,
          bond: 1,
        },
        {
          label: 'La laisser partir vers la rivière',
          stat: 'esprit',
          difficulty: 10,
          onSuccess:
            'La Meule glisse dans la rivière, et laisse derrière elle une odeur de victoire et un mot : merci.',
          onFailure: 'Elle s’accroche au panier et refuse de partir sans un discours. Le discours dure deux heures.',
          risk: 1,
        },
      ],
    },
  ],
  victory: {
    title: 'Le fromage a la parole',
    text: 'La Meule d’Or reste à Val-Coulant, ou part en rivière selon le choix de chacun. Le Comte de Brie jure qu’il n’a jamais été aussi ému, et Ferdinand retrouve enfin la couleur de ses oreilles. Le village garde une règle : on ne laisse plus un fromage seul dans une cave fermée à clé.',
  },
  defeat: {
    title: 'La fromagerie des murmures',
    text: 'La cave reste close, et la Meule disparaît sous une nappe de rumeurs. Les fromages de Val-Coulant murmurent désormais le nom de l’aventurier qui a échoué, et leur concours ne sera plus jamais le même.',
  },
};

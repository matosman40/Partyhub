import type { FallbackArc } from './fallback-arc.js';

/** Intrigue de secours « Les pigeons gouvernent » : un conseil de pigeons, une boulangère et de la levure. */
export const PIGEONS_ARC: FallbackArc = {
  world: {
    title: 'La Place de Montbrise',
    intro:
      'Sur la grande place de Montbrise, le conseil municipal a été remplacé, depuis un mois, par un conseil de pigeons. Ils votent en roucoulant, et leurs décisions s’affichent sur le kiosque, à coups de fientes.',
    goal: 'Faire réélire le maire avant le grand vote de dimanche, et récupérer la clé du beffroi.',
    secret:
      'La boulangère Rosalie a glissé de la levure dans les miettes des pigeons. Ils sont devenus plus gourmands, et ils votent désormais pour elle.',
  },
  npcs: [
    {
      name: 'Rosalie',
      title: 'Boulangère de la place',
      emoji: '🥖',
      attitude:
        'Très influente. Elle achète les voix à coups de croissants, et elle sait exactement qui a versé la levure.',
    },
    {
      name: 'Le Pigeon Ministre',
      title: 'Président du conseil des pigeons',
      emoji: '🐦',
      attitude:
        'Solennel. Il parle par roucoulades qu’un traducteur doit interpréter. Il négocie des miettes contre des voix.',
    },
    {
      name: 'Le maire Pommier',
      title: 'Maire déchu, caché dans le beffroi',
      emoji: '🎩',
      attitude:
        'Panique et cherche à reprendre la place. Il promet n’importe quoi, et accepte l’aide de n’importe qui.',
    },
  ],
  scenes: [
    {
      kind: 'choix',
      title: 'Le roucoulement de l’aube',
      text: 'Ce matin, le kiosque affiche une décision : « Miettes interdites sur la place pour les humains. » Les pigeons se rassemblent en silence, et l’huissier de la mairie tremble sur ses bottines.',
      choices: [
        {
          label: 'Demander au Pigeon Ministre pourquoi',
          stat: 'charme',
          difficulty: 10,
          onSuccess: 'Le Pigeon Ministre roucoule trois mots, que vous traduisez : « la boulangère a menti ».',
          onFailure: 'Il répond par une fiente bien placée, et le vote est confirmé à l’unanimité.',
          risk: 1,
        },
        {
          label: 'Ramasser les miettes tombées au sol',
          stat: 'ruse',
          difficulty: 9,
          onSuccess: 'Le croûton sent la levure de boulangerie, et non celle du pain de la place.',
          onFailure: 'Une dizaine de pigeons vous encerclent et vous poussent vers le kiosque.',
          item: 'Un croûton au sésame, qui sent la levure',
          risk: 1,
        },
      ],
    },
    {
      kind: 'dialogue',
      title: 'Rosalie au comptoir',
      text: 'La boulangerie sent le pain chaud. Rosalie essuie ses mains sur son tablier, et sourit comme une personne qui a déjà gagné.',
      npc: {
        name: 'Rosalie',
        title: 'Boulangère de la place',
        emoji: '🥖',
        attitude:
          'Très influente. Elle achète les voix à coups de croissants, et elle sait exactement qui a versé la levure.',
        line: 'Les pigeons ? Des électeurs comme les autres. Il suffit de bien les nourrir.',
      },
      choices: [
        {
          label: 'Lui demander la vérité sur la levure',
          stat: 'ruse',
          difficulty: 11,
          onSuccess: 'Elle sourit, puis avoue à demi-mot avoir voulu « aider » les pigeons à mieux voter.',
          onFailure: 'Elle vous glisse un croissant dans la poche : la manière polie de dire d’arrêter.',
          risk: 0,
          bond: -1,
        },
        {
          label: 'Lui proposer de rendre la place aux humains',
          stat: 'charme',
          difficulty: 12,
          onSuccess: 'Elle réfléchit, puis promet de retirer la levure si vous la couvrez devant le conseil.',
          onFailure: 'Elle rit : on ne négocie pas avec des oiseaux, ni avec des gens qui vont au marché.',
          risk: 0,
          bond: 1,
        },
      ],
    },
    {
      kind: 'enigme',
      title: 'Le mot de passe du kiosque',
      text: 'Le registre des votes est fermé par un mot de passe, peint en roucoulades sur le tableau. Les pigeons l’ont aussi brodé sur leurs ailes : « Ce qui se cache dans le pain et le fait gonfler. »',
      hint: 'Pensez à la boulangerie, et à ce qui fait lever la pâte.',
      choices: [
        {
          label: 'Répondre : la levure',
          stat: 'esprit',
          difficulty: 10,
          onSuccess: 'Le kiosque s’ouvre sur le registre : certains pigeons ont voté deux fois, pour Rosalie.',
          onFailure: 'Le kiosque se referme dans un claquement de pipe. Un pigeon vous regarde avec mépris.',
          item: 'Un bulletin de vote roucoulé',
          risk: 1,
        },
        {
          label: 'Gratter le tableau pour lire dessous',
          stat: 'ruse',
          difficulty: 11,
          onSuccess: 'Sous la peinture, vous trouvez la signature de la boulangère et une liste de promesses.',
          onFailure: 'La peinture part, mais aussi le tableau entier. La place vous hue.',
          risk: 1,
        },
      ],
    },
    {
      kind: 'halte',
      title: 'Une pause sur le banc',
      text: 'Le soleil tombe sur le banc de la place. Un vieux pigeon s’installe à côté de vous, et propose de partager votre pain avec la gravité d’un ancien ministre.',
      choices: [
        {
          label: 'Partager le pain avec lui',
          stat: 'charme',
          difficulty: 9,
          onSuccess: 'Il vous raconte la vraie histoire du beffroi : le maire y a caché un registre.',
          onFailure: 'Il picore la moitié du pain et s’envole sans un mot. Vous restez pensif un moment.',
          heal: 2,
          risk: 0,
        },
        {
          label: 'Dormir un peu à l’ombre du kiosque',
          stat: 'esprit',
          difficulty: 9,
          onSuccess: 'Vous rêvez d’un beffroi qui vous parle. Au réveil, une clé est dans votre main.',
          onFailure:
            'Vous vous réveillez en sursaut au milieu d’un vote. Personne ne vous a réveillé, sauf une fiente.',
          item: 'La clé du beffroi, en plastique',
          heal: 2,
          risk: 1,
        },
      ],
    },
    {
      kind: 'combat',
      title: 'La garde du beffroi',
      text: 'Au pied du beffroi, la garde des pigeons se déploie en formation serrée. Le Pigeon Ministre, perché sur le clocher, a donné l’ordre : personne ne monte sans vote favorable.',
      npc: {
        name: 'Le Pigeon Ministre',
        title: 'Président du conseil des pigeons',
        emoji: '🐦',
        attitude:
          'Solennel. Il parle par roucoulades qu’un traducteur doit interpréter. Il négocie des miettes contre des voix.',
        line: 'Personne ne monte au beffroi sans un vote favorable ! Roucou !',
      },
      enemy: {
        name: 'Garde du beffroi',
        title: 'Pigeon de garde',
        emoji: '🕊️',
        intro: 'Un pigeon de garde bloque l’escalier, les plumes hérissées. Il ne lâchera rien sans un vote.',
        hp: 9,
        defense: 11,
        damage: 2,
        onVictory: 'Le garde lâche la clé du beffroi, puis s’envole en roucoulant une menace voilée.',
        loot: 'Une plume dorée du Pigeon Ministre',
      },
    },
    {
      kind: 'choix',
      title: 'Le vote de dimanche',
      text: 'Dimanche, la place est pleine. Les pigeons votent sur le kiosque, Rosalie attend au premier rang, et le maire, enfin revenu, prononce un discours d’une voix désespérée.',
      choices: [
        {
          label: 'Révéler la levure devant toute la place',
          stat: 'ruse',
          difficulty: 12,
          onSuccess: 'Les pigeons comprennent qu’ils ont été manipulés, et votent contre Rosalie à l’unanimité.',
          onFailure: 'Ils roucoulent de colère, la foule se disperse, et Rosalie s’en sort encore une fois.',
          risk: 1,
          bond: -1,
        },
        {
          label: 'Proposer un compromis aux pigeons',
          stat: 'charme',
          difficulty: 11,
          onSuccess: 'Un nouveau conseil s’installe : pigeons et humains partagent la place, et les miettes.',
          onFailure: 'Le compromis est rejeté, mais le maire vous serre la main, admiratif.',
          risk: 0,
        },
      ],
    },
  ],
  victory: {
    title: 'La place retrouve ses miettes',
    text: 'Le conseil des pigeons se dissout dans un grand battement d’ailes, et la mairie reprend son trône de bois. Rosalie fait son mea culpa en pain d’épice, et le maire promet, pour la première fois, de tenir ses promesses. Sur le kiosque, un message reste affiché : « Miettes pour tous. »',
  },
  defeat: {
    title: 'Le règne des pigeons',
    text: 'Le conseil des pigeons reste en place, et le kiosque affiche chaque matin une nouvelle décision. Les habitants apprennent à sourire en levant les yeux, et Rosalie ouvre une succursale sur le toit du beffroi.',
  },
};

import { normalizeText, shuffle } from '../common/engine.js';
import { BLANK } from './rules.js';

/**
 * Phrases de secours : utilisées quand l’IA n’est pas configurée, injoignable ou répond hors format. Chaque phrase a
 * un seul trou et une réponse. Les cartes de leurre ne complètent pas bien les trous : elles font rire quand on les
 * pose. Les mots-clés ne sont pas utilisés ici, mais le jeu le dit à l’écran principal.
 */

export interface PhraseRound {
  sentence: string;
  answer: string;
}

/** Nombre minimal de cartes différentes pour distribuer des mains sans tout répéter. */
export const CURATED_CARDS_MIN = 8;

export interface PhraseContent {
  rounds: PhraseRound[];
  /** Toutes les cartes du jeu : les réponses et les leurres, sans doublon. */
  pool: string[];
}

const CURATED: PhraseRound[] = [
  { sentence: `Au petit-déjeuner, le chat a renversé son bol de ${BLANK}.`, answer: 'lait' },
  { sentence: `Pour réussir le gâteau, il ne faut pas oublier la pincée de ${BLANK}.`, answer: 'sel' },
  { sentence: `Le détective a trouvé une empreinte de ${BLANK} sur la scène du crime.`, answer: 'botte' },
  { sentence: `Dans l’espace, l’astronaute a planté un drapeau sur la ${BLANK}.`, answer: 'Lune' },
  { sentence: `Le volcan s’est réveillé et a craché de la ${BLANK}.`, answer: 'lave' },
  { sentence: `Pour éloigner les moustiques, rien ne vaut un peu de ${BLANK}.`, answer: 'citronnelle' },
  { sentence: `Le maître-nageur a sifflé : « Pas de ${BLANK} au bord du bassin ! »`, answer: 'course' },
  { sentence: `Le pirate a enterré son trésor au pied d’un ${BLANK}.`, answer: 'palmier' },
  { sentence: `Pour le dîner, grand-mère a préparé un ${BLANK} de légumes.`, answer: 'gratin' },
  { sentence: `Le facteur est arrivé en ${BLANK} sur son vélo.`, answer: 'retard' },
  { sentence: `La météo annonce de la neige sur les ${BLANK}.`, answer: 'Alpes' },
  { sentence: `Au zoo, le gardien nourrit les ${BLANK} à midi pile.`, answer: 'otaries' },
  { sentence: `Pour son anniversaire, mamie a reçu un pull orné d’un ${BLANK} géant.`, answer: 'homard' },
  { sentence: `En plein cours, le perroquet n’a cessé de crier « ${BLANK} ! »`, answer: 'Au voleur' },
  { sentence: `Le chef a goûté la sauce : « Il manque du ${BLANK} ! »`, answer: 'poivre' },
  {
    sentence: `Pour gagner le concours de pâtisserie, il a décoré son gâteau avec ${BLANK}.`,
    answer: 'des paillettes',
  },
  { sentence: `Le robot aspirateur s’est coincé sous le ${BLANK}.`, answer: 'canapé' },
  { sentence: `Le pompier est arrivé avec une échelle et ${BLANK} sous le bras.`, answer: 'un croissant' },
  { sentence: `Sur le bateau, le capitaine a crié : « Attention à la ${BLANK} ! »`, answer: 'baleine' },
  {
    sentence: `Le roi a décrété que tous ses sujets devaient porter ${BLANK} le dimanche.`,
    answer: 'un chapeau à plumes',
  },
  { sentence: `Le détective a découvert que le coupable n’était autre que ${BLANK}.`, answer: 'le facteur' },
  { sentence: `Pour son premier jour au bureau, il est venu en ${BLANK}.`, answer: 'pyjama' },
  { sentence: `Le vétérinaire a conseillé de donner moins de ${BLANK} au hamster.`, answer: 'biscuits' },
  { sentence: `Au camping, la tente s’est envolée au milieu d’une tempête de ${BLANK}.`, answer: 'confettis' },
  { sentence: `Le magicien a sorti de son chapeau un ${BLANK} qui parlait trois langues.`, answer: 'lapin' },
  { sentence: `Le joueur a marqué un but de la ${BLANK}.`, answer: 'tête' },
  {
    sentence: `Le conducteur a freiné si fort que tous les passagers se sont retrouvés sous le ${BLANK}.`,
    answer: 'siège',
  },
  { sentence: `Pour réparer le vélo, il a utilisé une clé à ${BLANK}.`, answer: 'molette' },
  { sentence: `La reine a ouvert le bal en dansant avec son ${BLANK}.`, answer: 'chien' },
  { sentence: `Ce matin, le réveil a sonné trois fois, puis le ${BLANK} est tombé du lit.`, answer: 'chat' },
  { sentence: `Dans la recette, il faut ajouter une cuillère de ${BLANK} et deux œufs.`, answer: 'farine' },
  { sentence: `Le photographe a demandé de sourire, mais le petit garçon a montré sa ${BLANK}.`, answer: 'langue' },
  { sentence: `Le juge a condamné l’accusé à faire la vaisselle pendant un ${BLANK}.`, answer: 'mois' },
  { sentence: `À la fête, le DJ a lancé une chanson de ${BLANK} que tout le monde connaît.`, answer: 'Noël' },
  { sentence: `Le pique-nique s’est terminé sous une averse de ${BLANK}.`, answer: 'glaçons' },
  { sentence: `Le jardinier a planté des tomates, mais elles ont poussé en forme de ${BLANK}.`, answer: 'girafe' },
  { sentence: `Au musée, le guide a expliqué que le tableau représentait un ${BLANK} en colère.`, answer: 'hérisson' },
  { sentence: `Mon voisin a repeint sa maison en ${BLANK} fluo.`, answer: 'vert' },
  { sentence: `Le professeur a demandé à Léo de copier cent fois « Je ne ${BLANK} pas en classe ».`, answer: 'chante' },
  { sentence: `Le gardien a arrêté le penalty avec ${BLANK}.`, answer: 'les orteils' },
  { sentence: `Le chef d’orchestre a levé sa baguette, et les ${BLANK} se sont mis à jouer.`, answer: 'violons' },
  { sentence: `Le train a eu du retard à cause d’un ${BLANK} de pigeons sur la voie.`, answer: 'troupeau' },
  { sentence: `La bibliothécaire a chuchoté : « Ici, on ne ${BLANK} ! »`, answer: 'danse' },
  { sentence: `Pour son entretien d’embauche, il a mis une cravate ornée de ${BLANK}.`, answer: 'petits canards' },
  {
    sentence: `Depuis la station spatiale, le message était clair : « Tout va bien, sauf le ${BLANK}. »`,
    answer: 'café',
  },
  { sentence: `Le cuisinier a fait brûler le poulet, et l’alarme a réveillé tout le ${BLANK}.`, answer: 'voisinage' },
  { sentence: `Le mariage a été interrompu par un ${BLANK} qui réclamait le bouquet.`, answer: 'hibou' },
  { sentence: `Papy a inventé une danse qu’il appelle « le ${BLANK} ».`, answer: 'pas du canard' },
  { sentence: `Le navigateur a perdu sa boussole, il s’est fié à son ${BLANK}.`, answer: 'instinct' },
  { sentence: `L’orchestre a joué si fort que les ${BLANK} se sont envolés.`, answer: 'moineaux' },
  { sentence: `Pour réussir son examen, Lou a révisé avec une ${BLANK} de café.`, answer: 'tasse' },
  { sentence: `Au restaurant, le serveur a proposé un ${BLANK} en guise de dessert.`, answer: 'tiramisu' },
  { sentence: `Les enfants ont construit un château de sable, puis une ${BLANK} l’a emporté.`, answer: 'vague' },
  { sentence: `La fusée est partie, mais elle a oublié le ${BLANK}.`, answer: 'compte à rebours' },
  { sentence: `Pour la rentrée, Théo a acheté une trousse en forme de ${BLANK}.`, answer: 'banane' },
];

const DECOYS = [
  'pantoufle',
  'saxophone',
  'crocodile',
  'cornichon',
  'parapluie',
  'brocoli',
  'tuba',
  'chaussette',
  'ananas',
  'trompette',
  'kangourou',
  'soupe',
  'yaourt',
  'casserole',
  'moustache',
  'fromage',
  'pelle',
  'brouette',
  'ornithorynque',
  'tondeuse',
  'nougat',
  'mouton',
  'accordéon',
  'sandale',
  'pizza',
  'hamac',
  'vuvuzela',
  'citrouille',
];

/** Dédoublonne en gardant la première forme, sans tenir compte de la casse ni des accents. */
export function uniqueCards(cards: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const card of cards) {
    const key = normalizeText(card);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

/** Contenu de secours : tirage au hasard parmi les phrases écrites à l’avance, avec des leurres. */
export function curatedContent(count: number, random: () => number): PhraseContent {
  const rounds = shuffle(CURATED, random).slice(0, Math.min(count, CURATED.length));
  const decoys = shuffle(DECOYS, random).slice(0, 12);
  return { rounds, pool: uniqueCards([...rounds.map((r) => r.answer), ...decoys]) };
}

/** Leurres écrits à l’avance qui ne figurent pas encore dans `have`, pour compléter un paquet trop mince. */
export function spareDecoys(have: string[]): string[] {
  const taken = new Set(have.map(normalizeText));
  return DECOYS.filter((card) => !taken.has(normalizeText(card)));
}

/** Phrases de secours non encore utilisées, pour compléter une réponse de l’IA trop courte. */
export function spareCurated(used: PhraseRound[], count: number): PhraseRound[] {
  const usedKeys = new Set(used.map((r) => normalizeText(r.sentence)));
  return CURATED.filter((r) => !usedKeys.has(normalizeText(r.sentence))).slice(0, count);
}

import { z } from 'zod';
import rawQuestions from './questions.fr.json' with { type: 'json' };
// Généré par scripts/questions-donnees-ouvertes.mjs (Wikidata, API Géo) : ne pas éditer à la main.
import openDataQuestions from './questions-ouvertes.fr.json' with { type: 'json' };
// Généré par scripts/quiz-musee-images.mjs (tableaux du Metropolitan Museum, CC0) : ne pas éditer à la main.
import museumQuestions from './questions-musee.fr.json' with { type: 'json' };

/**
 * Chargement et validation des questions au démarrage.
 * Un fichier mal formé fait échouer le démarrage avec un message explicite,
 * plutôt que de provoquer une erreur en pleine partie.
 */
/**
 * Image optionnelle d'une question : une œuvre ou un drapeau, servi localement sous /quiz-party/.
 * Le crédit et la licence restent affichés à la révélation.
 */
const imageSchema = z.object({
  src: z
    .string()
    .min(1)
    .refine((src) => src.startsWith('/quiz-party/') || src.startsWith('/api/images-ouvertes?u='), {
      message: 'L’image doit être servie sous /quiz-party/ ou par le relais /api/images-ouvertes',
    }),
  alt: z.string().min(1),
  credit: z.string().min(1),
  license: z.string().min(1),
  source: z.string().min(1),
});

export type QuizImage = z.infer<typeof imageSchema>;

export const questionSchema = z
  .object({
    id: z.string().min(1),
    category: z.string().min(1),
    question: z.string().min(5),
    choices: z.array(z.string().min(1)).min(2).max(4),
    answer: z.number().int().min(0),
    explanation: z.string().optional(),
    image: imageSchema.optional(),
  })
  .refine((q) => q.answer < q.choices.length, {
    message: 'L’index de la bonne réponse dépasse le nombre de choix',
  });

export type QuizQuestion = z.infer<typeof questionSchema>;

export const QUESTIONS: QuizQuestion[] = z
  .array(questionSchema)
  .min(1)
  .refine((list) => new Set(list.map((q) => q.id)).size === list.length, {
    message: 'Identifiant de question en double',
  })
  .parse([...rawQuestions, ...openDataQuestions, ...museumQuestions]);

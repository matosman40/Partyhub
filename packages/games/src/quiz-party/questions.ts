import { z } from 'zod';
import rawQuestions from './questions.fr.json' with { type: 'json' };

/**
 * Chargement et validation des questions au démarrage.
 * Un fichier mal formé fait échouer le démarrage avec un message explicite,
 * plutôt que de provoquer une erreur en pleine partie.
 */
const questionSchema = z
  .object({
    id: z.string().min(1),
    category: z.string().min(1),
    question: z.string().min(5),
    choices: z.array(z.string().min(1)).min(2).max(4),
    answer: z.number().int().min(0),
    explanation: z.string().optional(),
  })
  .refine((q) => q.answer < q.choices.length, {
    message: "L'index de la bonne réponse dépasse le nombre de choix",
  });

export type QuizQuestion = z.infer<typeof questionSchema>;

export const QUESTIONS: QuizQuestion[] = z.array(questionSchema).min(1).parse(rawQuestions);

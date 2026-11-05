import { z } from 'zod';
import rawPhotos from './photos.fr.json' with { type: 'json' };

/**
 * Banque de photos de Photo mystère, chargée et validée au démarrage. Le fichier est produit par
 * scripts/photo-mystere-photos.mjs à partir de Wikimedia Commons (licences libres, auteur et source notés).
 * Les coordonnées ne sortent jamais du serveur avant la révélation d’une manche.
 */
const photoSchema = z.object({
  id: z.string().min(1),
  place: z.string().min(1),
  country: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  file: z.string().min(1),
  credit: z.string().min(1),
  license: z.string().min(1),
  source: z.string().min(1),
});

export type Photo = z.infer<typeof photoSchema>;

export const PHOTOS: Photo[] = z
  .array(photoSchema)
  .min(1)
  .refine((list) => new Set(list.map((p) => p.id)).size === list.length, { message: 'Identifiant de photo en double' })
  .parse(rawPhotos);

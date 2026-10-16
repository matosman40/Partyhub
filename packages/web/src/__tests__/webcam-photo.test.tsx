import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WebcamPhoto, webcamAvailable, webcamErrorMessage } from '../profile/WebcamPhoto.js';

/**
 * Photo de profil à la webcam : la caméra n'est demandée qu'en https, les refus sont expliqués,
 * et l'écran d'ouverture donne une sortie (Annuler) dès le premier affichage.
 */

describe('Webcam de profil', () => {
  it('n’est pas proposée quand le navigateur n’a pas de caméra accessible (page non sécurisée)', () => {
    expect(webcamAvailable()).toBe(false);
  });

  it('explique le refus d’accès et l’absence de caméra', () => {
    const denied = new DOMException('refusé', 'NotAllowedError');
    expect(webcamErrorMessage(denied)).toMatch(/Autorisez la caméra/);
    const missing = new DOMException('aucune', 'NotFoundError');
    expect(webcamErrorMessage(missing)).toMatch(/Aucune caméra/);
    expect(webcamErrorMessage(new Error('autre'))).toMatch(/Réessayez/);
  });

  it('affiche l’ouverture de la caméra avec une sortie « Annuler » dès le premier affichage', () => {
    const html = renderToStaticMarkup(<WebcamPhoto onCapture={() => undefined} onCancel={() => undefined} />);
    expect(html).toContain('Ouverture de la caméra');
    expect(html).toContain('Annuler');
    expect(html).toContain('aria-label="Aperçu de la webcam"');
  });
});

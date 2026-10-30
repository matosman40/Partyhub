import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PORTRAIT_SEND_SIZE, type CharacterSpec, type PortraitErrorCode } from '@partyhub/shared';
import { canCreateFromPhoto, PortraitCharacter } from '../profile/PortraitCharacter.js';
import {
  mergePortraitCharacter,
  PORTRAIT_CONSENT_TEXT,
  PORTRAIT_ERROR_MESSAGES,
  portraitEnabled,
  portraitErrorMessage,
} from '../profile/portraitApi.js';
import { dataUrlBytes, fitDimensions } from '../profile/portraitImage.js';

/** Personnage à partir d'une photo : aucune requête réseau ni image réelle ici. */

const current: CharacterSpec = {
  body: 5,
  skin: 0,
  hair: 1,
  hairColor: 0,
  accessory: 0,
  expression: 0,
  pack: 'p1',
  look: 'l1',
};
const received: CharacterSpec = { body: 0, skin: 3, hair: 4, hairColor: 2, accessory: 4, expression: 2, pack: null };

const render = () =>
  renderToStaticMarkup(<PortraitCharacter current={current} onApply={() => undefined} available defaultOpen />);

describe('Personnage depuis une photo', () => {
  it('propose le bouton d’ouverture, puis la zone avec un consentement non coché', () => {
    const closed = renderToStaticMarkup(<PortraitCharacter current={current} onApply={() => undefined} available />);
    expect(closed).toContain('Créer depuis une photo');
    const html = render();
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/*"');
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('checked');
    expect(html).toContain('aria-live="polite"');
  });

  it('contient le texte de consentement exact', () => {
    expect(PORTRAIT_CONSENT_TEXT).toBe(
      'J’accepte que cette photo soit envoyée à Cloudflare (Workers AI) pour créer mon personnage. Elle n’est pas conservée par PartyHub : seul le personnage est gardé. Pour un enfant, l’accord d’un parent est nécessaire.',
    );
    expect(render().replace(/&#x27;/g, '’')).toContain(PORTRAIT_CONSENT_TEXT);
  });

  it('garde « Créer mon personnage » désactivé sans photo ni consentement', () => {
    expect(render()).toMatch(/<button[^>]*disabled=""[^>]*>Créer mon personnage<\/button>/);
    expect(canCreateFromPhoto(false, true, 'idle')).toBe(false);
    expect(canCreateFromPhoto(true, false, 'idle')).toBe(false);
    expect(canCreateFromPhoto(true, true, 'sending')).toBe(false);
    expect(canCreateFromPhoto(true, true, 'idle')).toBe(true);
  });

  it('n’affiche rien quand la fonction est absente (portrait: false ou inconnu)', () => {
    expect(portraitEnabled({ portrait: false })).toBe(false);
    expect(portraitEnabled({})).toBe(false);
    expect(portraitEnabled(null)).toBe(false);
    expect(portraitEnabled({ portrait: true })).toBe(true);
    const off = renderToStaticMarkup(
      <PortraitCharacter current={current} onApply={() => undefined} available={false} />,
    );
    expect(off).toBe('');
    const unknown = renderToStaticMarkup(
      <PortraitCharacter current={current} onApply={() => undefined} available={null} />,
    );
    expect(unknown).toBe('');
  });

  it('calcule les dimensions réduites sans agrandir', () => {
    expect(fitDimensions(3000, 1500)).toEqual({ width: PORTRAIT_SEND_SIZE, height: 384 });
    expect(fitDimensions(1500, 3000)).toEqual({ width: 384, height: PORTRAIT_SEND_SIZE });
    expect(fitDimensions(500, 400)).toEqual({ width: 500, height: 400 });
    expect(fitDimensions(768, 768)).toEqual({ width: 768, height: 768 });
    expect(fitDimensions(10_000, 1)).toEqual({ width: PORTRAIT_SEND_SIZE, height: 1 });
    expect(fitDimensions(0, 100)).toEqual({ width: 0, height: 0 });
  });

  it('mesure la taille décodée d’une data URL', () => {
    expect(dataUrlBytes('data:image/jpeg;base64,QUJD')).toBe(3);
    expect(dataUrlBytes('data:image/jpeg;base64,QUI=')).toBe(2);
    expect(dataUrlBytes('data:image/jpeg;base64,QQ==')).toBe(1);
  });

  it('fusionne le personnage reçu avec le personnage actuel : corps gardé, pack nul', () => {
    const merged = mergePortraitCharacter(received, current);
    expect(merged.body).toBe(5);
    expect(merged).toMatchObject({
      skin: 3,
      hair: 4,
      hairColor: 2,
      accessory: 4,
      expression: 2,
      pack: null,
      look: null,
    });
  });

  it('reprend la barbe et la couleur des yeux de la photo', () => {
    const merged = mergePortraitCharacter({ ...received, facialHair: 2, eyeColor: 3 }, current);
    expect(merged).toMatchObject({ facialHair: 2, eyeColor: 3 });
  });

  it('donne un message français par code d’erreur', () => {
    const codes: PortraitErrorCode[] = [
      'consent_required',
      'unauthorized',
      'too_large',
      'bad_type',
      'no_face',
      'several_faces',
      'rate_limited',
      'unavailable',
      'provider_error',
    ];
    for (const code of codes) expect(PORTRAIT_ERROR_MESSAGES[code].length).toBeGreaterThan(10);
    expect(portraitErrorMessage('no_face')).toBe('Je ne vois pas de visage : prenez une photo de face, bien éclairée.');
    expect(portraitErrorMessage('several_faces')).toBe('Une seule personne à la fois, s’il vous plaît.');
    expect(portraitErrorMessage('rate_limited')).toBe('Trop d’essais, réessayez dans quelques minutes.');
    expect(portraitErrorMessage('unavailable')).toMatch(/indisponible pour le moment/);
    expect(portraitErrorMessage('provider_error')).toBe(portraitErrorMessage('unavailable'));
    expect(portraitErrorMessage('inconnu')).toMatch(/indisponible/);
  });
});

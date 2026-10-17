/**
 * Consignes et illustrations originales d’Imite-moi. Les visages sont dessinés ici, en SVG :
 * aucun asset externe, aucune image reprise d’un autre jeu.
 */

export type Mode = 'galerie' | 'grimace' | 'cri';
export type ArtKey = 'lapin' | 'chat' | 'surpris' | 'endormi' | 'colere';

export interface PromptDef {
  title: string;
  art?: ArtKey;
}

const INK = '#2b1d3a';

function svg(body: string, background: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">` +
    `<rect width="200" height="200" rx="28" fill="${background}"/>${body}</svg>`
  );
}

const ART: Record<ArtKey, string> = {
  lapin: svg(
    `<ellipse cx="74" cy="52" rx="15" ry="46" fill="#fff" stroke="${INK}" stroke-width="5"/>
     <ellipse cx="126" cy="52" rx="15" ry="46" fill="#fff" stroke="${INK}" stroke-width="5"/>
     <ellipse cx="74" cy="56" rx="6" ry="32" fill="#ff9ec4"/>
     <ellipse cx="126" cy="56" rx="6" ry="32" fill="#ff9ec4"/>
     <circle cx="100" cy="124" r="50" fill="#fff" stroke="${INK}" stroke-width="5"/>
     <circle cx="82" cy="118" r="7" fill="${INK}"/>
     <circle cx="118" cy="118" r="7" fill="${INK}"/>
     <path d="M94 136 L106 136 L100 144 Z" fill="#ff7aa8" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
     <path d="M100 144 Q94 154 88 148 M100 144 Q106 154 112 148" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
     <path d="M60 136 L34 132 M60 144 L34 148 M140 136 L166 132 M140 144 L166 148" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
    '#ffd6e7',
  ),
  chat: svg(
    `<path d="M62 96 L56 46 L94 76 Z" fill="#fff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
     <path d="M138 96 L144 46 L106 76 Z" fill="#fff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
     <circle cx="100" cy="126" r="52" fill="#fff" stroke="${INK}" stroke-width="5"/>
     <path d="M70 110 L94 120 M130 110 L106 120" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
     <circle cx="82" cy="128" r="6" fill="${INK}"/>
     <circle cx="118" cy="128" r="6" fill="${INK}"/>
     <path d="M90 152 Q100 143 110 152" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
     <path d="M58 138 L28 132 M58 146 L28 150 M142 138 L172 132 M142 146 L172 150" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
    '#ffe7a3',
  ),
  surpris: svg(
    `<circle cx="100" cy="112" r="56" fill="#fff" stroke="${INK}" stroke-width="5"/>
     <circle cx="78" cy="100" r="16" fill="#fff" stroke="${INK}" stroke-width="4"/>
     <circle cx="122" cy="100" r="16" fill="#fff" stroke="${INK}" stroke-width="4"/>
     <circle cx="78" cy="102" r="6" fill="${INK}"/>
     <circle cx="122" cy="102" r="6" fill="${INK}"/>
     <path d="M66 74 Q78 66 90 74 M110 74 Q122 66 134 74" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
     <ellipse cx="100" cy="146" rx="11" ry="15" fill="${INK}"/>`,
    '#bfe6ff',
  ),
  endormi: svg(
    `<circle cx="100" cy="120" r="54" fill="#fff" stroke="${INK}" stroke-width="5"/>
     <path d="M66 120 Q80 132 94 120 M106 120 Q120 132 134 120" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
     <path d="M90 148 Q100 154 110 148" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
     <circle cx="60" cy="140" r="8" fill="#ffb3c7"/>
     <circle cx="140" cy="140" r="8" fill="#ffb3c7"/>
     <text x="136" y="56" font-size="36" font-weight="bold" fill="${INK}" font-family="sans-serif">z</text>
     <text x="156" y="36" font-size="24" font-weight="bold" fill="${INK}" font-family="sans-serif">z</text>`,
    '#d7d3ff',
  ),
  colere: svg(
    `<circle cx="100" cy="124" r="54" fill="#fff" stroke="${INK}" stroke-width="5"/>
     <path d="M62 100 L94 116 M138 100 L106 116" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
     <circle cx="84" cy="128" r="6" fill="${INK}"/>
     <circle cx="116" cy="128" r="6" fill="${INK}"/>
     <path d="M86 150 L114 150" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
     <path d="M34 80 Q28 96 38 110 M166 80 Q172 96 162 110" fill="none" stroke="#e5484d" stroke-width="5" stroke-linecap="round"/>`,
    '#ffc9b8',
  ),
};

/** Image d’une illustration, utilisable directement dans une balise img (data URL SVG). */
export function artUrl(key: ArtKey): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ART[key])}`;
}

/** Consignes par mode de manche : une phrase pour chaque téléphone. */
export const MODE_LABEL: Record<Mode, string> = {
  galerie: 'Galerie',
  grimace: 'Grimace',
  cri: 'Cri',
};

export const MODE_INSTRUCTION: Record<Mode, string> = {
  galerie: 'Choisissez dans votre galerie la photo qui correspond à la consigne.',
  grimace: 'Prenez-vous en photo : imitez la scène sur l’écran principal.',
  cri: 'Enregistrez 3 secondes de son : imitez la scène.',
};

/** Consignes tirées au sort pour chaque mode. Une consigne ne revient qu’après que toutes les autres sont passées. */
export const PROMPTS: Record<Mode, PromptDef[]> = {
  galerie: [
    { title: 'Trouvez une photo qui ressemble à ce lapin', art: 'lapin' },
    { title: 'Trouvez une photo qui ressemble à ce chat', art: 'chat' },
    { title: 'Trouvez une photo d’un animal qui a l’air coupable' },
    { title: 'Trouvez une photo de quelque chose de rond' },
    { title: 'Trouvez une photo qui ressemble à un lundi matin' },
    { title: 'Trouvez une photo de quelque chose de bleu' },
  ],
  grimace: [
    { title: 'Imitez ce lapin qui vient de voir une carotte', art: 'lapin' },
    { title: 'Faites la tête de ce chat qu’on vient de réveiller', art: 'chat' },
    { title: 'La grimace de la surprise : votre facture vient d’arriver', art: 'surpris' },
    { title: 'Tête d’endormi, le lundi à 7 heures', art: 'endormi' },
    { title: 'La tante qui vient de perdre au Uno', art: 'colere' },
  ],
  cri: [
    { title: 'Le cri d’un lapin qui vient d’entendre un bruit suspect' },
    { title: 'Une porte qui grince à minuit' },
    { title: 'Un canard qui a perdu ses clés' },
    { title: 'Une machine à café qui s’étouffe' },
  ],
};

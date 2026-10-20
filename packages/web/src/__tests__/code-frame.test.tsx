import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CodeFrame } from '../code-views/CodeFrame.js';

describe('vue d’un jeu de code', () => {
  it('ouvre seulement les capteurs et médias, jamais le réseau ni le stockage', () => {
    const html = renderToStaticMarkup(<CodeFrame role="host" url="/api/code-views/x/view.html" data={{}} />);
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).toContain('allow="accelerometer; autoplay; encrypted-media; gyroscope; camera; microphone"');
  });
});

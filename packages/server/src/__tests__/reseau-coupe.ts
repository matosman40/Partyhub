/**
 * Tests du serveur : aucune requête vers Internet. Les jeux qui tirent leur contenu en direct (Quiz Party, Photo
 * mystère, Tirage surprise) reçoivent un échec réseau immédiat et prennent leur banque locale, comme une installation
 * sans Internet. Les appels locaux (serveur de test sur 127.0.0.1) passent normalement.
 */
const fetchReel = globalThis.fetch;

globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const brut = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const hote = new URL(brut, 'http://127.0.0.1').hostname;
  if (hote !== '127.0.0.1' && hote !== 'localhost' && hote !== '::1' && hote !== '[::1]') {
    throw new TypeError(`Réseau coupé pendant les tests : ${hote}`);
  }
  return fetchReel(input, init);
}) as typeof fetch;

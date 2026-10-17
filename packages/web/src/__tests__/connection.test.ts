import { describe, expect, it, vi } from 'vitest';
import { canSend, OFFLINE_ACTION_ERROR } from '../connection.js';

/**
 * Une commande de l'utilisateur ne part qu'en ligne : hors connexion, socket.io la garderait pour la reconnexion,
 * où le salon la refuserait ou la perdrait sans message.
 */
describe('canSend', () => {
  it('laisse partir la commande quand la connexion est établie', () => {
    const show = vi.fn();
    expect(canSend({ connected: true }, show)).toBe(true);
    expect(show).not.toHaveBeenCalled();
  });

  it('bloque la commande hors connexion et affiche le message de coupure', () => {
    const show = vi.fn();
    expect(canSend({ connected: false }, show)).toBe(false);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith(OFFLINE_ACTION_ERROR);
  });
});

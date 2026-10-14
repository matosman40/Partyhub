/**
 * Codes de salle : 4 caractères, sans ambiguïté visuelle
 * (pas de 0/O, 1/I/L), faciles à lire sur un écran de TV.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;

const CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}

export function isValidRoomCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

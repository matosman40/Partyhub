import type { GameClientViews } from '../../client/types.js';
import { PokerHost } from './PokerHost.js';
import { PokerPlayer } from './PokerPlayer.js';
import { PokerSettings } from './PokerSettings.js';

export const pokerViews: GameClientViews = {
  Settings: PokerSettings,
  Host: PokerHost,
  Player: PokerPlayer,
};

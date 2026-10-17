import { Component, type ErrorInfo, type ReactNode } from 'react';
import { describeError, logClient } from '../log/clientLog.js';

interface BoundaryProps {
  children: ReactNode;
  /** Affiché à la place des enfants après une erreur de rendu. Une fonction reçoit l’erreur. */
  fallback: ReactNode | ((error: Error) => ReactNode);
  onError?: (error: Error, info: ErrorInfo) => void;
  /**
   * Quand cette valeur change après une erreur, la zone essaie de nouveau de s’afficher
   * (par exemple à la prochaine étape d’un jeu). Sans changement, le repli reste affiché.
   */
  resetKey?: string;
}

interface BoundaryState {
  error: Error | null;
}

/**
 * Filet de sécurité : une erreur de rendu n’efface pas toute la page (écran noir) mais ne remplace que
 * la zone concernée par le contenu de `fallback`.
 */
export class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidUpdate(prevProps: BoundaryProps): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const { message, stack } = describeError(error);
    const component = info.componentStack ? info.componentStack.trim().split('\n')[0]?.trim() : undefined;
    logClient('error', 'boundary', message, {
      stack: [stack, info.componentStack].filter(Boolean).join('\n'),
      extra: component ? { component } : undefined,
    });
    this.props.onError?.(error, info);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return typeof this.props.fallback === 'function' ? this.props.fallback(error) : this.props.fallback;
  }
}

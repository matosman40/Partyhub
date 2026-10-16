import { Component, type ErrorInfo, type ReactNode } from 'react';

interface BoundaryProps {
  children: ReactNode;
  /** Affiché à la place des enfants après une erreur de rendu. Une fonction reçoit l'erreur. */
  fallback: ReactNode | ((error: Error) => ReactNode);
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface BoundaryState {
  error: Error | null;
}

/**
 * Filet de sécurité : une erreur de rendu n'efface pas toute la page (écran noir) mais ne remplace que
 * la zone concernée par le contenu de `fallback`.
 */
export class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[PartyHub] erreur de rendu', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return typeof this.props.fallback === 'function' ? this.props.fallback(error) : this.props.fallback;
  }
}

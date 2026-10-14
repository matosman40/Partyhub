import { Component, type ErrorInfo, type ReactNode } from 'react';

interface BoundaryProps {
  children: ReactNode;
  /** Affiché à la place des enfants après une erreur de rendu. */
  fallback: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface BoundaryState {
  failed: boolean;
}

/** Filet de sécurité : une erreur dans une vue optionnelle (ex. 3D) ne bloque pas toute la page. */
export class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

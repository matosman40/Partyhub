// Contrôle statique du code TypeScript et React. Lancé par `npm run lint` et en intégration continue.
// Les erreurs bloquent ; les avertissements sont affichés sans faire échouer le contrôle.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'examples/**', 'packages/web/public/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // Seules les deux règles historiques des hooks : celles du React Compiler sont hors périmètre.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Une quarantaine de `any` existent (point 11 de la note d'améliorations) : on les signale, sans bloquer.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);

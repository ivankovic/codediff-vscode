// Flat config (ESLint 9). Type-aware linting is deliberately not enabled: tsc already runs with
// `strict` plus noUnusedLocals/noImplicitReturns/noUncheckedIndexedAccess in CI, so the type-aware
// rules would be a second, slower opinion about things the compiler already fails on.
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  { ignores: ['out/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      curly: 'error',
      eqeqeq: 'error',
      'no-throw-literal': 'error',
      // Off for TypeScript, on typescript-eslint's own advice: tsc already reports an undefined
      // identifier, and it does so knowing the ambient types (`Buffer`, the `NodeJS` namespace,
      // `vscode`) that this rule does not. Leaving it on means declaring every Node global by
      // hand and getting a second, worse answer to a question the compiler already answers.
      'no-undef': 'off',
    },
  },
];

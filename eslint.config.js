import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import globals from 'globals';

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      'dist/',
      'node_modules/',
      'coverage/',
      'public/',
      '*.config.js',
      '*.config.ts',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Type-aware settings + shared rules for all TypeScript files
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        // Type information powers the prefer-* and promise rules below.
        project: ['./tsconfig.server.json', './tsconfig.client.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.es2023,
      },
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',

      // General code quality
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'prettier/prettier': 'error',
    },
  },

  // Server-specific (Node globals; console allowed)
  {
    files: ['src/server/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // Client-specific (browser globals; discourage console)
  {
    files: ['src/client/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      'no-console': 'warn',
    },
  },

  // Build/maintenance scripts (Node globals; console allowed)
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // Tests
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },

  // Prettier compatibility layer must come last
  prettierConfig
);

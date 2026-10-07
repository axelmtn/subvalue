import ts from 'typescript-eslint';
export default ts.config(
  {
    ignores: [
      '**/dist/**',
      'node_modules/**',
      'artifacts/**',
      '.subvalue*/**',
      '.codex-remote-attachments/**',
    ],
  },
  ...ts.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        fetch: 'readonly',
        document: 'readonly',
        innerWidth: 'readonly',
      },
    },
  },
);

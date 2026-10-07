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
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Fixtures deliberately contain malformed and evolving provider schemas.
    // Production adapters must narrow unknown values before accessing fields.
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
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

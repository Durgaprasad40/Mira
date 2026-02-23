module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    es2021: true,
    node: true,
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    '.expo/',
    'convex/_generated/',
    '*.config.js',
    '*.config.ts',
    'metro.config.js',
    'babel.config.js',
  ],
  rules: {
    // Relaxed rules for existing codebase
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off', // Too many existing unused vars
    '@typescript-eslint/no-require-imports': 'off',
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/ban-ts-comment': 'off', // Allow @ts-ignore
    'no-console': 'off',
    'prefer-const': 'off',
    'no-empty': 'off', // Many empty catch blocks in codebase
    'no-case-declarations': 'off', // Allow declarations in case blocks
    'no-misleading-character-class': 'off', // Unicode emoji regex patterns
    'react-hooks/exhaustive-deps': 'warn', // Warn on missing deps
  },
};

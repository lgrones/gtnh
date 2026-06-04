import oxlint from 'eslint-plugin-oxlint';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Keep this for the compiler specific rules
export default defineConfig(
  [
    globalIgnores([
      '.git/',
      'build/',
      'dist/',
      'test_coverage/',
      'test_result/',
      '.vscode/',
      '.tanstack/',
      'public/',
      'node_modules/',
      '**/*/routeTree.gen.ts',
    ]),
  ],
  tseslint.configs.base,
  // React specific rules
  reactHooks.configs.flat.recommended,
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    languageOptions: { globals: globals.browser },
    settings: { react: { version: 'detect' } },
    rules: { 'react/prop-types': 'off' },
  },
  // Disable some rules in tests
  ...oxlint.buildFromOxlintConfigFile('./.oxlintrc.json'),
);

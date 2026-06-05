import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // resolve `@/…` path aliases so tests can import app modules that use them
  plugins: [tsconfigPaths()],
  test: {
    environment: 'jsdom', // store uses localStorage (persist) + DOM globals
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom', // store uses localStorage (persist) + DOM globals
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});

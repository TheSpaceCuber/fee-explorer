import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the built site works from any sub-path (e.g. GitHub Pages /waterfall/).
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});

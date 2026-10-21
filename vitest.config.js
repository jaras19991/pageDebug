import { defineConfig } from 'vitest/config';

// Unit tests run in plain Node; a test that needs a DOM opts in with
// `// @vitest-environment jsdom` at the top of the file.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
  },
});

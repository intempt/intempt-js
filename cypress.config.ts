import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    specPattern: '__tests__/**/*.cy.ts',
    supportFile: '__tests__/support/index.ts',
    setupNodeEvents(on, config) {
      // EnvConfig is initialized in __tests__/support/index.ts
      return config;
    },
  },
});

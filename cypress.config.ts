import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    specPattern: '__tests__/**/*.cy.ts',
    supportFile: '__tests__/support/index.ts',
  },

});

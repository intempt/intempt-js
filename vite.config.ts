import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist/',
    optimizeDeps: {
      include: ['prettier'],
    },
    rollupOptions: {
      input: 'src/main.ts',
      output: {
        entryFileNames: 'intempt.min.js',
      },
    },
  },
})

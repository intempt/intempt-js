import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: {
    pure: ['console.log'],
    minifyIdentifiers: false,
  },
  build: {
    outDir: 'dist/',
    minify:true,
    rollupOptions: {
      input: 'src/main.ts',
      output: {
        entryFileNames: 'intempt.min.js',
      },
    },
  },
})

import { defineConfig } from 'vite'
import terser from '@rollup/plugin-terser'
import { reservedWords } from './config/reservedWords.js'

export default defineConfig({
  esbuild: {
   pure: ['console.log'],
    minifyIdentifiers: false,
  },

  build: {
    outDir: 'dist/',
    minify: 'terser', // Switch to terser for better control
    rollupOptions: {
      input: 'src/main.ts',
      output: {
        entryFileNames: 'intempt.min.js',
        format: 'iife', // Use IIFE format to wrap code
        name: 'IntemptSDK', // Optional name for the IIFE
      },
      plugins: [
        terser({
          mangle: {
            reserved: reservedWords,
          },
          format: {
            comments: false,
          },
        }),
      ],
    },
  },
})
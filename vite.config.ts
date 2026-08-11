import { defineConfig } from 'vite'
import terser from '@rollup/plugin-terser'
import { reservedWords } from './config/reservedWords.js'
import { readFileSync } from 'node:fs'

// Single-source the SDK version from package.json — see src/shared/version.ts
const { version } = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }

export default defineConfig({
  define: {
    __SDK_VERSION__: JSON.stringify(version),
  },

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
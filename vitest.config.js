import { defineConfig } from 'vitest/config';
import path from 'path';

// Minimal config so Vitest resolves the '@/...' path alias the Next.js
// app uses. Added as part of BUG-02 so API route error-logging tests
// can import handlers that reference '@/lib/db'.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(process.cwd()),
    },
  },
});

// Shared setup for jsdom-based UI tests.
//
// Import this once at the top of every tests/ui/*.test.js file. Those files
// MUST also carry the `// @vitest-environment jsdom` docblock on line 1 so
// only the UI suite runs under jsdom — the existing node/real-DB suites are
// untouched (their default environment stays `node`).
//
// Responsibilities:
//   1. Register @testing-library/jest-dom matchers (toBeInTheDocument, etc.).
//   2. Wire React Testing Library auto-cleanup. The repo runs Vitest WITHOUT
//      globals (see vitest.config.js — every test imports from 'vitest'),
//      so RTL's automatic afterEach(cleanup) does not self-register; we do it
//      here explicitly. Importing this module runs the afterEach registration
//      in the importing file's scope.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

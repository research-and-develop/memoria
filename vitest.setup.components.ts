// Per-file setup for the `components` project (jsdom). Touches nothing
// external — component tests run without a database or network.
//   1. Registers @testing-library/jest-dom matchers on vitest's `expect`.
//   2. Unmounts whatever a test rendered, so no DOM leaks into the next one.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

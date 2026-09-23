import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// vitest.config.ts does not set `test.globals: true`, so
// @testing-library/react's own auto-cleanup (which relies on a global
// `afterEach`) never registers — without this, DOM from one test's
// render() call was still mounted when the next test's render() ran in
// the same file, producing duplicate-element query failures.
afterEach(cleanup);

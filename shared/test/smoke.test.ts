import { expect, it } from 'vitest';
import { SHARED_READY } from '../src/index';

it('shared package is ready', () => {
  expect(SHARED_READY).toBe(true);
});

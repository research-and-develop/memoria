// Per-file setup for the `components` project (jsdom). Touches nothing
// external — component tests run without a database or network.
//   1. Registers @testing-library/jest-dom matchers on vitest's `expect`.
//   2. Unmounts whatever a test rendered, so no DOM leaks into the next one.
//   3. Gives jsdom's <dialog> the methods it lacks (showModal/show/close). Focus
//      trapping, Esc and the inert page are the browser's: checked by hand.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

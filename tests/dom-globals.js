// dom-globals.js — creates the jsdom environment and installs the browser globals.
//
// This MUST run before react-dom is loaded: React decides once, at import time, whether it is running in
// a browser. If the globals arrive later it falls back to a legacy path where events never reach
// onChange (and it logs "attachEvent is not a function"). tests/dom.jsx therefore imports this first and
// loads React DOM lazily.
import './setup.js';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
export const { window } = dom;

// jsdom has no modal <dialog> support; the app only needs open/close plus the cancel event.
if (!window.HTMLDialogElement.prototype.showModal) {
  window.HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  window.HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new window.Event('close'));
  };
}

// Demo receipts are drawn on a canvas, which jsdom does not implement.
const realCreateElement = window.document.createElement.bind(window.document);
const noopContext = new Proxy({}, { get: () => () => {}, set: () => true });
window.document.createElement = (tag, ...rest) => {
  if (String(tag).toLowerCase() === 'canvas') {
    return { width: 0, height: 0, getContext: () => noopContext, toDataURL: () => `data:image/jpeg;base64,${'A'.repeat(400)}` };
  }
  return realCreateElement(tag, ...rest);
};

// jsdom cannot decode images or create blob URLs. These stubs let the receipt path run (choose → resize →
// store → preview → remove); the real compression is measured in the browser pass.
window.URL.createObjectURL = () => 'blob:stub';
window.URL.revokeObjectURL = () => {};
// The app calls the global URL (Node's), whose createObjectURL demands a real Blob.
globalThis.URL.createObjectURL = () => 'blob:stub';
globalThis.URL.revokeObjectURL = () => {};
class StubImage {
  naturalWidth = 3000;
  naturalHeight = 4000;
  set src(value) {
    this._src = value;
    // Tests that want to observe the "processing" state set a delay first (default: immediate).
    setTimeout(() => this.onload?.(), globalThis.__stubImageDelay ?? 0);
  }
  get src() {
    return this._src;
  }
}
window.Image = StubImage;
window.scrollTo = () => {}; // jsdom logs "not implemented" otherwise

for (const key of [
  'window', 'document', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'StorageEvent', 'FormData',
  'Node', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'Image',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
]) {
  globalThis[key] = key === 'window' ? window : window[key];
}
// globalThis.navigator is getter-only in Node, so it has to be redefined rather than assigned.
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

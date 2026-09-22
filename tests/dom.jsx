// dom.jsx — renders the real app in jsdom for the UI tests.
// Storage stays the in-memory shim from setup.js (storage.js is the only code that reads it), so these
// tests exercise the same domain layer as the headless suites.
//
// React DOM, the router and the app are imported LAZILY: the browser globals must exist first (see
// dom-globals.js), otherwise React decides it is not in a browser and never delivers events to onChange.
import { window } from './dom-globals.js';
import { act } from 'react';

let deps;
async function load() {
  if (!deps) {
    const [{ createRoot }, router, { App }, company, auth] = await Promise.all([
      import('react-dom/client'),
      import('react-router'),
      import('../src/App.jsx'),
      import('../src/app/CompanyContext.jsx'),
      import('../src/app/AuthContext.jsx'),
    ]);
    deps = { createRoot, router, App, CompanyProvider: company.CompanyProvider, AuthProvider: auth.AuthProvider };
  }
  return deps;
}

// Renders the whole app at `path`.
export async function renderApp(path = '/') {
  const { App } = await load();
  return renderTree(<App />, path);
}

// Renders one guard at /secret inside the data + session providers. Anything the guard redirects to
// lands on a plain page, so a redirect settles instead of re-rendering the guard forever.
export async function renderGuard(element, path = '/secret') {
  const { router, CompanyProvider, AuthProvider } = await load();
  const { Route, Routes } = router;
  return renderTree(
    <CompanyProvider>
      <AuthProvider>
        <Routes>
          <Route path="/secret" element={element} />
          <Route path="*" element={<p>redirected</p>} />
        </Routes>
      </AuthProvider>
    </CompanyProvider>,
    path,
  );
}

// Returns helpers for reading and driving whatever was rendered.
async function renderTree(tree, path) {
  const { createRoot, router } = await load();
  const { MemoryRouter, useLocation } = router;
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const root = createRoot(container);
  let current = { pathname: path };

  function LocationProbe() {
    current = useLocation();
    return null;
  }

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        {tree}
        <LocationProbe />
      </MemoryRouter>,
    );
  });

  const screen = {
    container,
    get path() {
      return current.pathname;
    },
    get text() {
      return window.document.body.textContent.replace(/\s+/g, ' ');
    },
    get title() {
      return window.document.title;
    },
    find: (selector) => container.querySelector(selector),
    findAll: (selector) => [...container.querySelectorAll(selector)],
    // The element whose text contains `text` (buttons, links, headings…).
    byText: (selector, text) => [...container.querySelectorAll(selector)].find((el) => el.textContent.includes(text)) ?? null,
    // Dialogs are appended at body level by the provider, outside the container.
    dialog: () => window.document.querySelector('dialog[open]'),
    async click(element) {
      if (!element) throw new Error('click(): element not found');
      await act(async () => {
        element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    },
    async press(element, key) {
      await act(async () => {
        element.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      });
    },
    // Types into a controlled field: React tracks the previous value, so the NATIVE setter must be used
    // (assigning .value directly would be swallowed as "no change").
    async change(element, value) {
      if (!element) throw new Error('change(): element not found');
      const proto = element.tagName === 'SELECT'
        ? window.HTMLSelectElement
        : element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(element, value);
      await act(async () => {
        element.dispatchEvent(new window.Event('input', { bubbles: true }));
        element.dispatchEvent(new window.Event('change', { bubbles: true }));
      });
    },
    // Picks files in a file input (jsdom has no file picker). `files` are plain {name, type, size}.
    // `settle: false` returns while the image is still being processed, so that state can be asserted.
    async setFiles(input, files, { settle = true } = {}) {
      Object.defineProperty(input, 'files', { configurable: true, value: { ...files, length: files.length, item: (i) => files[i] } });
      await act(async () => {
        input.dispatchEvent(new window.Event('change', { bubbles: true }));
      });
      if (!settle) return;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5)); // let the image decode settle
      });
    },
    // Forms that read their values with FormData (login, signup, setup, password change).
    fill(form, values) {
      for (const [name, value] of Object.entries(values)) form.elements[name].value = value;
    },
    async submit(form) {
      await act(async () => {
        form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      });
    },
    // Simulates another tab writing to storage (V1's cross-tab redraw).
    async storageEvent(key = 'exc:session') {
      await act(async () => {
        window.dispatchEvent(new window.StorageEvent('storage', { key }));
      });
    },
    async waitFor(predicate, { timeout = 2000 } = {}) {
      const started = Date.now();
      for (;;) {
        if (predicate()) return;
        if (Date.now() - started > timeout) throw new Error('waitFor: timed out');
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
  return screen;
}

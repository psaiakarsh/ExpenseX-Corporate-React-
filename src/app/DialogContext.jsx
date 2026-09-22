// DialogContext — the promise-based dialog API from V1 (ui.js), backed by React state.
//   const result = await openFormDialog({ title, fields, onSubmit });   // null when cancelled
//   if (await confirmAction({ title, message })) { … }
//   if (await confirmTyped({ title, message, word: 'RESET' })) { … }    // destructive actions
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { FormDialog } from '../components/dialogs.jsx';

const DialogContext = createContext(null);

export function DialogProvider({ children }) {
  const [stack, setStack] = useState([]);
  const nextId = useRef(0);

  const openFormDialog = useCallback((config) => new Promise((resolve) => {
    const id = ++nextId.current;
    setStack((current) => [...current, { id, config, resolve }]);
  }), []);

  const close = useCallback((id, result) => {
    setStack((current) => {
      const entry = current.find((item) => item.id === id);
      entry?.resolve(result);
      return current.filter((item) => item.id !== id);
    });
  }, []);

  const confirmAction = useCallback(async ({ title, message, confirmLabel = 'Confirm', danger = false }) => {
    const result = await openFormDialog({
      title,
      description: <p>{message}</p>,
      submitLabel: confirmLabel,
      danger,
      onSubmit: () => ({ ok: true }),
    });
    return Boolean(result);
  }, [openFormDialog]);

  // Destructive actions ask the user to type a word (e.g. RESET) so they can't happen by accident.
  const confirmTyped = useCallback(async ({ title, message, word, confirmLabel }) => {
    const result = await openFormDialog({
      title,
      description: <p>{message}</p>,
      fields: [{ name: 'typed', label: `Type ${word} to confirm`, required: true, autocomplete: 'off' }],
      submitLabel: confirmLabel,
      danger: true,
      onSubmit: ({ typed }) => (typed.trim() === word ? { ok: true } : { ok: false, errors: { typed: `Type ${word} exactly.` } }),
    });
    return Boolean(result);
  }, [openFormDialog]);

  const value = useMemo(() => ({ openFormDialog, confirmAction, confirmTyped }), [openFormDialog, confirmAction, confirmTyped]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      {stack.map(({ id, config }) => (
        <FormDialog key={id} {...config} onClose={(result) => close(id, result)} />
      ))}
    </DialogContext.Provider>
  );
}

export function useDialogs() {
  const context = useContext(DialogContext);
  if (!context) throw new Error('useDialogs() must be used inside <DialogProvider>.');
  return context;
}

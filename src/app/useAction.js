// useAction — runs a domain action and reports its result (V1 ui.js runAction).
// The rules stay in the domain: this only shows the message it returns and re-reads the data.
import { useCallback } from 'react';
import { useCompany } from './CompanyContext.jsx';
import { useToast } from './ToastContext.jsx';

export function useAction() {
  const toast = useToast();
  const { refresh } = useCompany();

  return useCallback((action, successMessage) => {
    let result;
    try {
      result = action();
      if (result?.ok === false) {
        toast(result.error ?? Object.values(result.errors ?? {})[0] ?? 'Something went wrong.', 'error');
      } else if (successMessage) {
        toast(successMessage);
      }
    } catch (error) {
      // Thrown only for storage failures ("storage is full"); nothing was saved.
      toast(error.message, 'error');
      result = { ok: false, error: error.message };
    }
    refresh();
    return result;
  }, [toast, refresh]);
}

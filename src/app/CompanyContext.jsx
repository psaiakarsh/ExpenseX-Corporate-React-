// CompanyContext — the company data snapshot every page reads from.
//
// There is no copy of the data in React state: `db` is simply loadDb() (storage.js) re-read whenever
// `version` changes. Domain actions write through storage.js; the caller then calls refresh().
// Another tab's change arrives as a window "storage" event and triggers the same re-read — this is
// V1's startPage() redraw-on-storage behaviour. Corrupted data makes loadDb() throw during render;
// the ErrorBoundary above shows the fatal-error screen (V1 showFatalError).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { STORAGE_PREFIX, loadDb } from '../domain/storage.js';

const CompanyContext = createContext(null);

export function CompanyProvider({ children }) {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    // key === null means another tab cleared storage.
    const onStorage = (event) => {
      if (event.key === null || event.key.startsWith(STORAGE_PREFIX)) refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the re-read trigger
  const db = useMemo(() => loadDb(), [version]);
  const value = useMemo(() => ({ db, version, refresh }), [db, version, refresh]);
  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (!context) throw new Error('useCompany() must be used inside <CompanyProvider>.');
  return context;
}

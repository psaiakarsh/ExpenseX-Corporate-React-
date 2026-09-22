// ToastContext — short status messages (V1 ui.js toast / setFlash / showFlash).
//
// The live region is always mounted, so screen readers already know it when the first message arrives
// (the fix V1 needed a delay for). A message for the NEXT page (V1's sessionStorage "flash") is passed as
// router state — navigate(path, { state: { flash } }) — and shown by <RouteFlash> once per navigation.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { Icon } from '../components/ui.jsx';

const ToastContext = createContext(null);
const ICON_FOR = { error: 'alert', info: 'info', success: 'check' };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Set());
  const nextId = useRef(0);

  const later = useCallback((fn, ms) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      fn();
    }, ms);
    timers.current.add(timer);
  }, []);

  const toast = useCallback((message, type = 'success') => {
    const id = ++nextId.current;
    setToasts((list) => [...list, { id, message, type, leaving: false }]);
    later(() => {
      setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      later(() => setToasts((list) => list.filter((t) => t.id !== id)), 250);
    }, type === 'error' ? 6000 : 3500);
  }, [later]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}${t.leaving ? ' toast-leaving' : ''}`}>
            <Icon name={ICON_FOR[t.type] ?? 'check'} size={18} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast() must be used inside <ToastProvider>.');
  return context;
}

// Shows `location.state.flash` ({ message, type }) once for each navigation that carries one.
export function RouteFlash() {
  const location = useLocation();
  const toast = useToast();
  const shownFor = useRef(null);
  useEffect(() => {
    const flash = location.state?.flash;
    if (flash && shownFor.current !== location.key) {
      shownFor.current = location.key;
      toast(flash.message, flash.type ?? 'info');
    }
  }, [location, toast]);
  return null;
}

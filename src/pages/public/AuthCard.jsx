// AuthCard — the shared frame of the login / signup / setup screens (V1 auth-page markup).
import { useEffect } from 'react';
import { BrandMark } from '../../components/ui.jsx';

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

export function AuthCard({ titleId, title, subtitle = null, children }) {
  return (
    <section className="card auth-card" aria-labelledby={titleId}>
      <div className="brand brand-lg auth-brand">
        <BrandMark size={56} />
      </div>
      <div>
        <h1 id={titleId}>{title}</h1>
        {subtitle ? <p className="muted small">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

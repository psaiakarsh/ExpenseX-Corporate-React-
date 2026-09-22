// forms.jsx — labelled fields with inline errors, and the error handling V1 had in showFieldErrors():
// mark fields invalid, link the message with aria-describedby, and move focus to the FIRST invalid field
// in page order. Forms are uncontrolled (values read with FormData on submit), as in V1.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// One labelled control. `as` picks input (default), textarea or select.
export function Field({
  name, label, error, hint, as = 'input', idPrefix = '', optionalMark = false, required = false, children, ...controlProps
}) {
  const id = idPrefix ? `${idPrefix}-${name}` : name;
  const hintId = hint ? `${id}-hint` : '';
  const errorId = `${id}-error`;
  const Control = as;
  const common = {
    id,
    name,
    required,
    'aria-describedby': `${hintId} ${errorId}`.trim(),
    'aria-invalid': error ? 'true' : undefined,
    ...controlProps,
  };
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {optionalMark && !required ? <> <span className="optional">(optional)</span></> : null}
      </label>
      <Control {...common}>{children}</Control>
      {hint ? <p className="field-hint" id={hintId}>{hint}</p> : null}
      <p className="field-error" id={errorId} hidden={!error}>{error ?? ''}</p>
    </div>
  );
}

// The form-level message: an explicit error, or (as in V1) the first field message when no field shows it.
export function FormError({ errors = {}, formError = '', fields = [] }) {
  const orphan = Object.keys(errors).find((key) => !fields.includes(key));
  const message = formError || (orphan ? errors[orphan] : '');
  return <p className="form-error" role="alert" hidden={!message}>{message}</p>;
}

// Holds { errors, formError } for a form and focuses the first invalid control after each report.
export function useFormErrors(formRef) {
  const [state, setState] = useState({ errors: {}, formError: '', stamp: 0 });
  const stamp = useRef(0);

  const show = useCallback((result = {}) => {
    stamp.current += 1;
    setState({ errors: result.errors ?? {}, formError: result.error ?? '', stamp: stamp.current });
  }, []);

  const clear = useCallback(() => setState({ errors: {}, formError: '', stamp: 0 }), []);

  useEffect(() => {
    if (!state.stamp) return;
    formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
  }, [state.stamp, formRef]);

  return useMemo(() => ({ errors: state.errors, formError: state.formError, show, clear }), [state, show, clear]);
}

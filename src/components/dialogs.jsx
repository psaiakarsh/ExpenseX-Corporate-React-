// dialogs.jsx — native <dialog> modals (V1 ui.js openFormDialog / confirmAction / confirmTyped).
//
// The browser traps focus and draws the backdrop. As in V1, Escape is handled directly as well as through
// the "cancel" event (some browsers don't fire it for every press), and focus returns to the element that
// opened the dialog.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Field, FormError, useFormErrors } from './forms.jsx';
import { Icon } from './ui.jsx';

// Opens a <dialog> modally for as long as it is mounted; returns the ref to attach.
// `onCancel` runs on Escape, the backdrop's cancel event, or a click on a [data-cancel] control.
export function useModalDialog(onCancel) {
  const ref = useRef(null);
  const opener = useRef(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useEffect(() => {
    const dialog = ref.current;
    opener.current = document.activeElement;
    dialog?.showModal?.();
    return () => {
      dialog?.close?.();
      const previous = opener.current;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const onKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel.current?.();
    }
  }, []);

  const onCancelEvent = useCallback((event) => {
    event.preventDefault();
    cancel.current?.();
  }, []);

  return { ref, dialogProps: { ref, onKeyDown, onCancel: onCancelEvent } };
}

// fields: [{ name, label, type, value, options, required, maxLength, hint, autocomplete, inputMode, placeholder }]
// onSubmit(values) → { ok: true } closes with that result; { ok: false, errors, error } keeps it open.
export function FormDialog({ title, description = null, fields = [], submitLabel = 'Save', danger = false, onSubmit, onClose }) {
  const titleId = useId();
  const formRef = useRef(null);
  const { errors, formError, show, clear } = useFormErrors(formRef);
  const [busy, setBusy] = useState(false);
  const { dialogProps } = useModalDialog(() => onClose(null));

  useEffect(() => {
    const form = formRef.current;
    (form?.querySelector('input, select, textarea') ?? form?.querySelector('button[type="submit"]'))?.focus();
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    clear();
    setBusy(true);
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const outcome = await onSubmit(values);
      if (outcome?.ok) {
        onClose(outcome);
        return;
      }
      show(outcome ?? {});
    } catch (error) {
      show({ error: error.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog className="dialog" aria-labelledby={titleId} {...dialogProps}>
      <form ref={formRef} className="dialog-form" noValidate onSubmit={handleSubmit}>
        <header className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => onClose(null)}><Icon name="x" /></button>
        </header>
        {description ? <div className="dialog-description">{description}</div> : null}
        {fields.map((field) => (
          <Field
            key={field.name}
            idPrefix={titleId}
            name={field.name}
            label={field.label}
            as={field.type === 'textarea' ? 'textarea' : field.type === 'select' ? 'select' : 'input'}
            type={field.type === 'textarea' || field.type === 'select' ? undefined : field.type ?? 'text'}
            rows={field.type === 'textarea' ? 3 : undefined}
            defaultValue={field.value ?? ''}
            required={Boolean(field.required)}
            optionalMark
            maxLength={field.maxLength}
            autoComplete={field.autocomplete}
            inputMode={field.inputMode}
            placeholder={field.placeholder}
            hint={field.hint}
            error={errors[field.name]}
          >
            {field.type === 'select'
              ? (field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)
              : undefined}
          </Field>
        ))}
        <FormError errors={errors} formError={formError} fields={fields.map((field) => field.name)} />
        <footer className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => onClose(null)}>Cancel</button>
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy} aria-busy={busy}>
            {busy ? 'Working…' : submitLabel}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

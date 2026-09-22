// filters.jsx — the V1 filter toolbars (search + selects) and their state.
// Filtering itself lives in the domain (expense-query.js); this only collects the values.
import { useState } from 'react';
import { useSearchParams } from 'react-router';

export function Toolbar({ label, children }) {
  return (
    // onSubmit is prevented so Enter in the search box doesn't reload (V1 used onsubmit="return false").
    <form className="toolbar" role="search" aria-label={label} onSubmit={(event) => event.preventDefault()}>
      {children}
    </form>
  );
}

export function SearchFilter({ value, onChange, placeholder = 'Title, notes, project…', id = 'search' }) {
  return (
    <div className="field toolbar-search">
      <label htmlFor={id}>Search</label>
      <input className="control" id={id} name={id} type="search" placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

// options: [{ value, label }]
export function SelectFilter({ id, label, value, options, onChange }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select className="control" id={id} name={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

export const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'highest', label: 'Highest amount' },
  { value: 'lowest', label: 'Lowest amount' },
];

// Filter state, seeded once from the URL (V1 read ?status= / ?employee= on the first render only).
export function useFilters(initial, queryKeys = []) {
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => {
    const seeded = { ...initial };
    for (const key of queryKeys) {
      const value = searchParams.get(key);
      if (value) seeded[key] = value;
    }
    return seeded;
  });
  const set = (name, value) => setFilters((current) => ({ ...current, [name]: value }));
  return [filters, set];
}

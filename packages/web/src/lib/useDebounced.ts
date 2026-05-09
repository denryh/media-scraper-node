import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const h = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(h);
  }, [value, delayMs]);
  return debounced;
}

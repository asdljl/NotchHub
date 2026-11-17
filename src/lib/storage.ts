import { useEffect, useRef, useState } from "react";

/**
 * localStorage-backed state. Reads once on mount, writes on every change.
 * WebView2 keeps localStorage between launches, so this survives restarts.
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
  revive?: (raw: unknown) => T,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      const parsed = JSON.parse(raw) as unknown;
      return revive ? revive(parsed) : (parsed as T);
    } catch {
      return initial;
    }
  });

  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    try {
      localStorage.setItem(keyRef.current, JSON.stringify(value));
    } catch {
      /* quota exceeded — non fatal */
    }
  }, [value]);

  return [value, setValue] as const;
}

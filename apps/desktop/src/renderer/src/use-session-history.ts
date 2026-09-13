import { useEffect, useRef, useState } from 'react';
export function useSessionHistory<T>(current: T, restore: (value: T) => void) {
  const [history, setHistory] = useState<T[]>([]);
  const previous = useRef(current);
  const restoring = useRef<string | null>(null);
  const key = JSON.stringify(current);
  useEffect(() => {
    if (JSON.stringify(previous.current) === key) return;
    const old = previous.current;
    previous.current = current;
    if (restoring.current === key) {
      restoring.current = null;
      return;
    }
    setHistory((items) => [...items.slice(-29), old]);
  }, [key]);
  return {
    canGoBack: history.length > 0,
    back: () => {
      const target = history.at(-1);
      if (!target) return;
      restoring.current = JSON.stringify(target);
      setHistory((items) => items.slice(0, -1));
      restore(target);
    },
  };
}

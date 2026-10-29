import { useCallback, useEffect, useState } from 'react';

/** Fetch data on mount (and when deps change), with a manual reload. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fn, deps);

  const reload = useCallback(
    () =>
      load()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e: Error) => setError(e.message)),
    [load],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, reload, setData };
}

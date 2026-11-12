import { useCallback, useEffect, useRef, useState } from "react";
import { mergeUnique } from "./playback-policy";

/** 极简异步加载 hook：返回数据、加载态、错误与手动重载。 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const epoch = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    const ticket = ++epoch.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fnRef.current();
      if (alive.current && ticket === epoch.current) setData(res);
    } catch (e) {
      if (alive.current && ticket === epoch.current) setError((e as Error).message || "加载失败");
    } finally {
      if (alive.current && ticket === epoch.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    setData(null);
    run();
    return () => { alive.current = false; ++epoch.current; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload: run, setData };
}

/** 分页列表：滚动到底自动加载下一页。 */
export function usePaged<T>(fetcher: (page: number) => Promise<{ items: T[]; pagination?: { pages: number } }>, deps: unknown[] = []) {
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0), alive = useRef(true), pending = useRef<number | null>(null);
  const cursor = useRef({ page: 0, pages: 1 });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const loadMore = useCallback(async () => {
    const ticket = epoch.current;
    if (!alive.current || pending.current === ticket || cursor.current.page >= cursor.current.pages) return;
    pending.current = ticket;
    setLoading(true);
    setError(null);
    try {
      const next = cursor.current.page + 1;
      const res = await fetcherRef.current(next);
      if (!alive.current || ticket !== epoch.current) return;
      const incoming = Array.isArray(res?.items) ? res.items : [];
      const total = incoming.length ? Math.max(next, Number(res.pagination?.pages) || next) : next;
      cursor.current = { page: next, pages: total };
      setItems((prev) => mergeUnique(prev, incoming));
      setPage(next);
      setPages(total);
      setError(null);
    } catch (e) {
      if (alive.current && ticket === epoch.current) setError((e as Error).message || "加载失败");
    } finally {
      if (alive.current && ticket === epoch.current) { pending.current = null; setLoading(false); }
    }
  }, []);

  const reset = useCallback(() => {
    ++epoch.current; pending.current = null; cursor.current = { page: 0, pages: 1 };
    setItems([]);
    setPage(0);
    setPages(1);
    setError(null);
    setLoading(false);
    void loadMore();
  }, [loadMore]);

  useEffect(() => {
    alive.current = true;
    reset();
    return () => { alive.current = false; ++epoch.current; pending.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { items, page, pages, loading, error, loadMore, hasMore: page < pages, reset };
}

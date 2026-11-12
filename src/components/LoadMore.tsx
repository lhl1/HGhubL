import { useEffect, useRef } from "react";

export default function LoadMore({ loading, error, hasMore, count, onLoad, automatic = true }: {
  loading: boolean; error: string | null; hasMore: boolean; count: number; onLoad: () => void; automatic?: boolean;
}) {
  const marker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!automatic || loading || error || !hasMore || !marker.current) return;
    const observer = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) onLoad(); }, { rootMargin: "320px" });
    observer.observe(marker.current); return () => observer.disconnect();
  }, [automatic, loading, error, hasMore, count, onLoad]);
  return <div ref={marker} className="hg-load-more" aria-live="polite">
    {loading ? <span className="flex items-center gap-2"><span className="w-4 h-4 spinner" />正在加载</span>
      : error ? <><span>加载未完成</span><button onClick={onLoad} title={error}>重新加载</button></>
      : hasMore ? <button onClick={onLoad}>加载更多</button> : count > 0 ? <span>已展示全部内容</span> : null}
  </div>;
}

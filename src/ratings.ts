import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { RatingInfo } from "./types";

export function ratingSummary(value: RatingInfo, fallback = 0) {
  if (!Number.isFinite(fallback) || fallback < 0 || fallback > 10) fallback = 0;
  const raw = value.score;
  const parsed = raw === undefined || raw === null || raw === "" ? NaN : Number(raw);
  const score = Number.isFinite(parsed) && parsed >= 0 && parsed <= 10 ? parsed : fallback;
  const total = value.rating_cnt === undefined || value.rating_cnt === "" ? NaN : Number(value.rating_cnt);
  return { score, count: Number.isFinite(total) && total >= 0 ? Math.floor(total) : null };
}
export function useVideoRating(id: number, fallback: number, active: boolean) {
  const current = useRef({ id, active }); current.current = { id, active };
  const generation = useRef(0), readSequence = useRef(0);
  const [result, setResult] = useState<{ id: number; value: ReturnType<typeof ratingSummary> } | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const fallbackRef = useRef(fallback); fallbackRef.current = fallback;
  const load = useCallback(async () => {
    if (!current.current.active || current.current.id <= 0) return;
    const target = current.current.id, ticket = generation.current, sequence = ++readSequence.current;
    setLoading(true); setError("");
    try {
      const value = await api.rating(target);
      if (target === current.current.id && ticket === generation.current && sequence === readSequence.current) setResult({ id: target, value: ratingSummary(value, fallbackRef.current) });
    } catch (reason) {
      if (target === current.current.id && ticket === generation.current && sequence === readSequence.current) setError((reason as Error).message || "评分加载失败");
    } finally {
      if (ticket === generation.current && sequence === readSequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    ++generation.current; setError(""); setLoading(false);
    if (active && id > 0) void load();
    return () => { ++generation.current; ++readSequence.current; };
  }, [id, active, load]);
  const summary = result?.id === id ? result.value : ratingSummary({}, fallback);
  return { ...summary, loading, error, reload: load };
}
export type VideoRatingState = ReturnType<typeof useVideoRating>;

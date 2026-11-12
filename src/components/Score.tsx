import { scoreValue } from "../catalog";
import { IStarF } from "../icons";

export function ScoreBadge({ score, cover = false }: { score: unknown; cover?: boolean }) {
  const value = scoreValue(score);
  return <span className={`ref-score-badge ${cover ? "is-cover" : ""} ${value ? "" : "is-unrated"}`} aria-label={value ? `综合评分 ${value.toFixed(1)} 分` : "暂无评分"}><IStarF size={11} />{value ? `${value.toFixed(1)} 分` : "暂无评分"}</span>;
}
export function ScoreSort({ priority, onChange }: { priority: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" className="ref-score-sort" aria-label="评分优先" aria-pressed={priority} title="按已加载作品的综合评分从高到低排列；无评分排后" onClick={() => onChange(!priority)}><IStarF size={13} />评分优先</button>;
}
export function ScoreSortNote({ priority }: { priority: boolean }) {
  return priority ? <p className="ref-filter-note" role="status">已加载作品按评分从高到低排列，无评分排后；继续加载会更新排序。</p> : null;
}

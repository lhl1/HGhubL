import { useState } from "react";
import type { CatalogMetadata } from "../types";
import { IChevronDown, IChevronUp } from "../icons";
import SelectMenu from "./SelectMenu";

export default function CatalogFilters({ metadata, selected, onChange, finished, onFinished, loading = false, compact = false }: {
  metadata: CatalogMetadata | null; selected: Record<string, string>; onChange: (value: Record<string, string>) => void;
  finished: string; onFinished: (value: string) => void; loading?: boolean; compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = (metadata?.tags || []).filter((row) => row.tags?.length);
  const visible = expanded ? rows : rows.slice(0, 3);
  if (compact) return <div className="ref-rank-selects" aria-label="榜单细分筛选">
    <label><span>完结状态</span><SelectMenu label="榜单完结状态" value={finished} options={[{ value: "", label: "全部" }, { value: "finished", label: "已完结" }, { value: "ongoing", label: "连载中" }]} onChange={onFinished} /></label>
    {rows.map((row) => <label key={row.code}><span>{row.name}</span><SelectMenu label={`${row.name}筛选`} value={selected[row.code] || ""}
      options={[{ value: "", label: "全部" }, ...row.tags.map((tag) => ({ value: tag.name, label: tag.name }))]}
      onChange={(value) => onChange({ ...selected, [row.code]: value })} /></label>)}
    {loading && !rows.length && <span className="ref-filter-loading">正在加载筛选项</span>}
  </div>;
  return <div className="ref-official-filters" aria-label="剧集筛选">
    <div className="ref-filter-row"><span>状态</span><div role="group" aria-label="完结状态">
      {[{ value: "", label: "全部" }, { value: "finished", label: "已完结" }, { value: "ongoing", label: "连载中" }].map((option) => <button key={option.value} aria-pressed={finished === option.value} onClick={() => onFinished(option.value)}>{option.label}</button>)}
    </div></div>
    {visible.map((row) => <div key={row.code} className="ref-filter-row" data-filter-row={row.code}><span>{row.name}</span>
      <div role="group" aria-label={row.name}><button aria-pressed={!selected[row.code]} onClick={() => onChange({ ...selected, [row.code]: "" })}>全部</button>
        {row.tags.map((tag) => <button key={tag.id} aria-pressed={selected[row.code] === tag.name}
          onClick={() => onChange({ ...selected, [row.code]: selected[row.code] === tag.name ? "" : tag.name })}>{tag.name}</button>)}
      </div>
    </div>)}
    {loading && !rows.length && <div className="ref-filter-skeleton" aria-label="正在加载筛选项"><i /><i /><i /></div>}
    {rows.length > 3 && <button className="ref-filter-fold" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起筛选" : "展开筛选"}{expanded ? <IChevronUp size={14} /> : <IChevronDown size={14} />}</button>}
  </div>;
}

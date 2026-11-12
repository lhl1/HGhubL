import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAsync, usePaged } from "../hooks";
import { useStore } from "../store";
import { catalogCategories, CATALOG_SORTS, FALLBACK_CATEGORIES, filterCatalog, orderByScore } from "../catalog";
import CatalogFilters from "../components/CatalogFilters";
import { CatalogSkeleton, Masonry } from "../components/cards";
import { CatalogViewSwitch } from "../components/CatalogLayout";
import LoadMore from "../components/LoadMore";
import { Empty } from "../components/ui";
import { IBack, IGrid, IRefresh, ISearch, ITrophy } from "../icons";

export const CHANNELS = FALLBACK_CATEGORIES.map((channel) => ({ cate: channel.route, name: channel.name, desc: "发现更多作品" }));
export default function Category({ wide }: { wide: boolean }) { return <CatalogBrowser wide={wide} />; }
export function ChannelPage({ cate, name, onBack, wide }: { cate: string; name: string; onBack: () => void; wide: boolean }) {
  return <CatalogBrowser initialCategory={cate} name={name} onBack={onBack} wide={wide} />;
}
function CatalogBrowser({ initialCategory = "", name, onBack, wide }: { initialCategory?: string; name?: string; onBack?: () => void; wide: boolean }) {
  const { push, requestSearch } = useStore();
  const metadata = useAsync(() => api.catalogMetadata());
  const [category, setCategory] = useState(initialCategory), [sort, setSort] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>({}), [finished, setFinished] = useState("");
  const [wordOffset, setWordOffset] = useState(0);
  const { items, loading, error, loadMore, hasMore, reset } = usePaged((page) => api.catalog(category, sort === "score" ? "" : sort, page, 24), [category, sort === "score" ? "" : sort]);
  useEffect(() => { setCategory(initialCategory); }, [initialCategory]);
  const categories = catalogCategories(metadata.data);
  const words = (metadata.data?.hot || []).filter((tag) => tag.name);
  const filtered = useMemo(() => orderByScore(filterCatalog(items, selected, finished), sort === "score"), [items, selected, finished, sort]);
  const resetAll = () => { if (category === initialCategory && !sort) reset(); setCategory(initialCategory); setSort(""); setSelected({}); setFinished(""); };
  return <div className="absolute inset-0 scroll-y ref-page-scroll"><section className="ref-catalog-page" aria-busy={loading}>
    <div className="ref-explore-shortcuts"><button onClick={() => push({ kind: "ranks" })}><ITrophy size={19} />排行榜</button>
      <button onClick={() => { if (!sort) reset(); else setSort(""); }}><IRefresh size={18} />最近更新</button>
      <button onClick={() => push({ kind: "posts" })}><IGrid size={19} />图文社区</button>
    </div>
    <div className="ref-guess-section"><div className="ref-section-heading"><h2>猜你想搜</h2><button disabled={!words.length} onClick={() => setWordOffset((value) => (value + 4) % words.length)}><IRefresh size={14} />换一批</button></div>
      <div className="ref-guess-words">{words.length ? words.slice(wordOffset, wordOffset + 4).map((tag) => <button key={tag.id} onClick={() => requestSearch(tag.name)}><ISearch size={14} /><span className="ref-hot-word" title={tag.name}>{tag.name}</span></button>) : <span>选择分类，发现你的下一部好剧</span>}</div>
    </div>
    <header className="ref-filter-page-heading"><div>{onBack && <button aria-label="返回" onClick={onBack}><IBack size={18} /></button>}<div><h2>{name || "分类筛选"}</h2><p>找到合你心意的好剧</p></div></div>
      <button onClick={resetAll}><IRefresh size={14} />重置</button></header>
    <div className="ref-filter-surface">
      <div className="ref-filter-row"><span>分类</span><div role="group" aria-label="作品分类"><button aria-pressed={!category} onClick={() => setCategory("")}>全部</button>{categories.map((item) => <button key={item.route} aria-pressed={category === item.route} onClick={() => { setCategory(item.route); setSelected({}); }}>{item.name}</button>)}</div></div>
      <div className="ref-filter-row"><span>排序</span><div role="group" aria-label="作品排序">{CATALOG_SORTS.map((item) => <button key={item.value} aria-pressed={sort === item.value} onClick={() => setSort(item.value)}>{!category && !item.value ? "最近上新" : item.label}</button>)}</div></div>
      <CatalogFilters metadata={metadata.data} selected={selected} onChange={setSelected} finished={finished} onFinished={setFinished} loading={metadata.loading} />
      {metadata.error && <div className="ref-inline-error">筛选选项加载失败<button onClick={metadata.reload}>重新加载</button></div>}
    </div>
    <div className="ref-section-heading ref-results-heading"><div><strong>筛选结果</strong><span>已显示 {filtered.length} 部 · 已加载 {items.length} 部</span></div><div className="ref-heading-actions"><CatalogViewSwitch /><button disabled={loading} onClick={reset}><IRefresh size={14} />刷新</button></div></div>
    <p className="ref-filter-note">评分优先按已加载作品从高到低排列，无评分排后；题材和完结状态筛选已加载作品，继续加载可扩大范围。</p>
    {filtered.length ? <Masonry videos={filtered} tools={false} wide={wide} onOpen={(video) => push({ kind: "feed", videoIds: filtered.map((item) => item.id), index: filtered.findIndex((item) => item.id === video.id), title: name || "分类筛选" })} />
      : loading && !items.length ? <CatalogSkeleton wide={wide} /> : error && !items.length ? <Empty icon={<IGrid size={28} />} title="分类暂时无法加载" sub={error} action="重试" onAction={reset} />
        : <Empty icon={<IGrid size={28} />} title="当前条件暂无作品" sub={hasMore ? "可继续加载更多作品，或调整筛选条件" : "试试其他分类与题材"} />}
    {(items.length > 0 || hasMore && !loading && !error) && <LoadMore loading={loading} error={error} hasMore={hasMore} count={items.length} onLoad={loadMore} automatic={filtered.length > 0} />}
  </section></div>;
}

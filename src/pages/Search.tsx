import { ScoreSort, ScoreSortNote } from "../components/Score";
import { orderByScore } from "../catalog";
import { useEffect, useRef, useState } from "react";
import { api, fmt } from "../api";
import type { RankItem, VideoCard } from "../types";
import { useStore } from "../store";
import { CatalogSkeleton, Masonry, RankRow } from "../components/cards";
import { usePaged } from "../hooks";
import LoadMore from "../components/LoadMore";
import { Empty } from "../components/ui";
import { IBack, IClose, IFireF, IRefresh, ISearch, ITrophy } from "../icons";

const HOT_TAGS = ["都市", "逆袭", "古风", "系统", "后宫", "校园", "仙侠", "职场", "大男主", "御姐", "脑洞", "奇幻"];

export default function Search({ active, wide }: { active: boolean; wide: boolean }) {
  const { push, searchHist, addSearch, clearSearchHist, toast, searchQuery, searchRequest } = useStore();
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState(false);
  const [submitted, setSubmitted] = useState("");
  const { items, loading, error: err, loadMore, hasMore, reset } = usePaged<VideoCard>((page) => submitted
    ? api.search(submitted, page, 20) : Promise.resolve({ items: [], pagination: { pages: 1 } }), [submitted]);
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  useEffect(() => {
    if (searchRequest && searchQuery) { setQ(searchQuery); if (submitted === searchQuery) reset(); else setSubmitted(searchQuery); addSearch(searchQuery); }
  }, [searchRequest, searchQuery, addSearch]);

  useEffect(() => {
    if (active && !/Android/i.test(navigator.userAgent)) inputRef.current?.focus();
  }, [active]);

  const submit = (keyword: string) => {
    const k = keyword.trim();
    if (!k) return;
    setQ(k);
    if (submitted === k) reset(); else setSubmitted(k);
    addSearch(k);
  };

  const querying = submitted.length > 0;
  const videos = orderByScore(items, priority);

  return (
    <div className="absolute inset-0 bg-bg flex flex-col ref-search-page">
      {/* 搜索栏 */}
      <div className="shrink-0 px-4 pb-3 flex items-center gap-2.5" style={{ paddingTop: "calc(var(--sat, 0px) + 12px)" }}>
        <form className="flex-1 flex items-center gap-2 h-11 rounded-(--r-ctl) bg-s3 px-3.5 focus-within:bg-s4 transition-colors"
          role="search" onSubmit={(e) => { e.preventDefault(); if (!composing.current) submit(q); }}>
          <ISearch size={17} className="text-mut shrink-0" />
          <input ref={inputRef} value={q} aria-label="搜索关键词" maxLength={100} autoComplete="off" onChange={(e) => setQ(e.target.value)} placeholder="搜索短剧、作者、题材…"
            onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={(event) => { if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing)) event.preventDefault(); }}
            className="flex-1 min-w-0 bg-transparent text-[13.5px] text-on placeholder-dim outline-none" />
          {q && <button type="button" aria-label="清空搜索" onClick={() => { setQ(""); setSubmitted(""); inputRef.current?.focus(); }} className="w-5 h-5 rounded-full bg-s4 flex items-center justify-center text-mut pressable"><IClose size={11} /></button>}
          <button type="submit" className="hg-search-submit">搜索</button>
        </form>
        <button onClick={() => push({ kind: "ranks" })} aria-label="排行榜"
          className="w-11 h-11 rounded-(--r-sm) flex items-center justify-center bg-primary text-on-primary pressable elev-2">
          <ITrophy size={19} />
        </button>
      </div>

      <div className="flex-1 scroll-y px-4 pb-24">
        {!querying ? (
          <>
            {searchHist.length > 0 && (
              <div className="mt-1 a-rise">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold text-on">搜索历史</span>
                  <button onClick={clearSearchHist} className="text-[11px] text-dim pressable">清空</button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {searchHist.map((h) => (
                    <button key={h} onClick={() => { setQ(h); submit(h); }} className="px-3.5 h-8 rounded-(--r-ctl) bg-s3 text-[12px] text-on/80 pressable">{h}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 rounded-(--r-md) bg-s2 p-3.5 a-rise">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-on/90"><IFireF size={15} className="text-primary" />热门题材</span>
                <button onClick={() => push({ kind: "ranks" })} className="text-[11px] text-primary font-semibold pressable">完整榜单 ›</button>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {HOT_TAGS.map((t) => (
                  <button key={t} onClick={() => { setQ(t); submit(t); }}
                    className="px-3 h-7 rounded-(--r-ctl) bg-s3 text-[12px] text-on/85 pressable">{t}</button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between mt-6 mb-2.5">
              <span className="text-[13px] font-bold text-on">为你推荐</span>
              <button onClick={() => submit(HOT_TAGS[Math.floor(Math.random() * HOT_TAGS.length)])}
                className="flex items-center gap-1 text-[11.5px] text-mut pressable"><IRefresh size={13} />换一批</button>
            </div>
            <p className="text-[11.5px] text-dim leading-relaxed">
              输入关键词后按回车搜索，也可以点上面的题材直接看片单。
            </p>
          </>
        ) : (
          <>
            <div className="text-[11.5px] text-mut mt-1 mb-2.5" aria-live="polite">「{submitted}」已加载 <span className="text-primary font-bold">{items.length}</span> 条结果</div>
            <div className="ref-heading-actions"><ScoreSort priority={priority} onChange={setPriority} /></div><ScoreSortNote priority={priority} />
            {videos.length ? (
              <>
                <Masonry videos={videos} wide={wide} onOpen={(v) => push({ kind: "feed", videoIds: videos.map((x) => x.id), index: videos.findIndex((x) => x.id === v.id), title: `搜索 · ${submitted}` })} />
                <LoadMore loading={loading} error={err} hasMore={hasMore} count={items.length} onLoad={loadMore} />
              </>
            ) : loading ? (
              <CatalogSkeleton wide={wide} />
            ) : (
              <Empty icon={<ISearch size={26} />} title={err ? "搜索暂时无法完成" : "没有找到相关内容"} sub={err || "换个关键词试试，比如「都市」「逆袭」"}
                action={err ? "重新搜索" : "看看热榜"} onAction={err ? reset : () => push({ kind: "ranks" })} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export { default as RankPage } from "./Rankings";

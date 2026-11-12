import { ScoreSort, ScoreSortNote } from "../components/Score";
import { orderByScore } from "../catalog";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useAsync } from "../hooks";
import { useStore } from "../store";
import { rankingCards } from "../discovery";
import { catalogCategories } from "../catalog";
import type { VideoCard } from "../types";
import { CatalogSkeleton, Masonry } from "../components/cards";
import { HotWords, TopicGrid } from "../components/DiscoveryContent";
import { Empty, Img } from "../components/ui";
import { IChevronDown, IChevronUp, IGrid, IPlayF, IRefresh, ISearch, ITrophy } from "../icons";

export default function Home({ active, bottomInset, wide = true }: { active: boolean; bottomInset: number; wide?: boolean }) {
  const { push, openExplore, setTab } = useStore();
  const home = useAsync(() => api.home());
  const metadata = useAsync(async () => {
    if (!home.data) return null;
    if (home.data.hot_tags) return { categories: [], sorts: [], tags: [], hot: home.data.hot_tags };
    return api.catalogMetadata();
  }, [home.data]);
  const hot = useAsync(() => api.rank("hot"));
  const [priority, setPriority] = useState(false);
  const [slide, setSlide] = useState(0), [interacting, setInteracting] = useState(false);
  const banners = home.data?.banners || [], banner = banners[slide % Math.max(1, banners.length)];
  useEffect(() => {
    if (!active || interacting || banners.length < 2) return;
    const timer = window.setInterval(() => setSlide((value) => (value + 1) % banners.length), 7000);
    return () => window.clearInterval(timer);
  }, [active, interacting, banners.length]);
  const categories = catalogCategories(metadata.data);
  const hotItems = orderByScore(home.data?.hot?.length ? home.data.hot : rankingCards(hot.data?.items || []), priority);
  const openVideo = (items: VideoCard[], item: VideoCard, title: string) => push({ kind: "feed", videoIds: items.map((video) => video.id), index: items.findIndex((video) => video.id === item.id), title });
  const section = (title: string, source: VideoCard[], more: () => void) => { const items = orderByScore(source, priority); return <section className="ref-home-section" aria-label={title}>
    <div className="ref-section-heading"><h2>{title}</h2><button onClick={more}>查看全部 ›</button></div>
    {items.length ? <Masonry videos={items} tools={false} wide={wide} onOpen={(item) => openVideo(items, item, title)} /> : <p className="ref-empty-section">暂无作品</p>}
  </section>; };
  return <div className="absolute inset-0 scroll-y ref-page-scroll"><main className="ref-home-page" style={{ paddingBottom: bottomInset + 28 }} aria-label="网页首页">
    <div className="ref-home-mobile-heading"><strong>HGhub</strong><button aria-label="搜索" onClick={() => setTab("search")}><ISearch size={20} /></button></div>
    {home.error && <div className="ref-inline-error" role="alert">首页加载失败<button onClick={home.reload}>重试首页</button></div>}
    {banner && <section className="ref-home-hero" aria-label="首页精选轮播" onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setInteracting(false); }}>
      <div className="ref-home-hero-cover"><Img src={banner.image} eager alt="" /></div><div className="ref-home-hero-shade" />
      <div className="ref-home-hero-copy"><span className="ref-eyebrow">今日精选</span><h2>{banner.title}</h2><p>{banner.desc?.replace(/<[^>]*>/g, " ")}</p>
        <div className="ref-hero-actions"><button className="ref-action-primary" onClick={() => push({ kind: "feed", videoIds: [banner.video_id], index: 0, title: "首页精选" })}><IPlayF size={16} />查看剧集</button><button onClick={() => openExplore()}>探索更多 ›</button></div></div>
      <div className="ref-hero-pager"><button aria-label="上一张精选" disabled={banners.length < 2} onClick={() => setSlide((value) => (value - 1 + banners.length) % banners.length)}><IChevronUp size={17} className="-rotate-90" /></button>
        <span>{slide % banners.length + 1} / {banners.length}</span><button aria-label="下一张精选" disabled={banners.length < 2} onClick={() => setSlide((value) => (value + 1) % banners.length)}><IChevronDown size={17} className="-rotate-90" /></button></div>
    </section>}
    {home.loading && !home.data && <CatalogSkeleton wide={wide} />}
    {!home.loading && !home.data && home.error && <Empty icon={<IRefresh size={26} />} title="首页暂时无法加载" sub={home.error} action="重新加载" onAction={home.reload} />}
    <nav className="ref-home-shortcuts" aria-label="首页快捷入口">
      <button onClick={() => openExplore()}><ISearch size={19} /><span>探索全部</span></button><button onClick={() => openExplore("original")}><IPlayF size={19} /><span>黄果原创</span></button>
      <button onClick={() => openExplore("short")}><IPlayF size={19} /><span>短剧</span></button><button onClick={() => openExplore("comic")}><IGrid size={19} /><span>漫剧</span></button>
      <button onClick={() => openExplore("topics")}><IGrid size={19} /><span>专题合集</span></button><button onClick={() => push({ kind: "ranks" })}><ITrophy size={19} /><span>排行榜</span></button>
      <button onClick={() => openExplore("posts")}><IGrid size={19} /><span>图文与剧评</span></button><button onClick={() => setTab("watch")}><IPlayF size={19} /><span>连续放映</span></button>
    </nav>
    <HotWords />
    <div className="ref-section-heading"><h2>发现好剧</h2><ScoreSort priority={priority} onChange={setPriority} /></div><ScoreSortNote priority={priority} />
    <section className="ref-home-tags" aria-label="热门标签"><div className="ref-section-heading"><h2>热门标签</h2><button onClick={() => setTab("category")}>更多题材 ›</button></div>
      <div>{(metadata.data?.hot || []).slice(0, 16).map((tag) => <button key={tag.slug || tag.id} onClick={() => push({ kind: "tag", slug: tag.slug, title: tag.name })}>{tag.name}</button>)}</div>
      {metadata.error && <div className="ref-inline-error">标签加载失败<button onClick={metadata.reload}>重试标签</button></div>}
    </section>
    {home.data && <>
      {section("精选推荐", home.data.featured, () => openExplore("recommend"))}
      {section("最近上新", home.data.latest, () => openExplore("latest"))}
      {home.data.cate_rec.map((group) => <div key={`${group.cate_id}:${group.cate_name}`}>{section(group.cate_name, group.videos, () => {
        const category = categories.find((item) => item.id === group.cate_id || item.name === group.cate_name);
        if (category) push({ kind: "channel", cate: category.route, name: group.cate_name }); else setTab("category");
      })}</div>)}
    </>}
    <section className="ref-home-section" aria-label="热播短剧"><div className="ref-section-heading"><h2>热播短剧</h2><button onClick={() => openExplore("hot")}>更多热播 ›</button></div>
      {hotItems.length ? <Masonry videos={hotItems.slice(0, 8)} tools={false} wide={wide} onOpen={(item) => openVideo(hotItems, item, "热播短剧")} />
        : hot.loading ? <CatalogSkeleton wide={wide} /> : hot.error ? <div className="ref-inline-error">热播加载失败<button onClick={hot.reload}>重试热播</button></div> : <p className="ref-empty-section">暂无热播作品</p>}
    </section>
    {home.data && <section className="ref-home-section" aria-label="专题推荐"><div className="ref-section-heading"><h2>专题推荐</h2><button onClick={() => openExplore("topics")}>查看全部 ›</button></div>
      {home.data.topic_rec.length ? <TopicGrid items={home.data.topic_rec} /> : <p className="ref-empty-section">暂无专题</p>}</section>}
    <footer className="ref-home-footer"><span>继续探索，找到下一部好剧</span><button onClick={() => openExplore("latest")}>浏览最近上新 ›</button></footer>
  </main></div>;
}

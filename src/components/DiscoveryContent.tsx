import { ScoreSort, ScoreSortNote } from "./Score";
import { normalizeHotWords } from "../hot-words";
import { orderByScore } from "../catalog";
import { useEffect, useRef, useState } from "react";
import { api, fmt } from "../api";
import { useAsync, usePaged } from "../hooks";
import { useStore } from "../store";
import type { DiscoverySection, DiscoveryVideoSection, Topic, TopicDetail } from "../types";
import { DISCOVERY_SECTIONS } from "../discovery";
import { CatalogSkeleton, Masonry } from "./cards";
import { CatalogViewSwitch } from "./CatalogLayout";
import { Empty, Img } from "./ui";
import LoadMore from "./LoadMore";
import { IBack, IRefresh, ISearch } from "../icons";

export function HotWords() {
  const { requestSearch } = useStore(), words = useAsync(async () => {
    const data = await api.searchHot();
    const items = normalizeHotWords(Array.isArray(data?.items) ? data.items : []);
    if (items.length) return { items };
    const metadata = await api.catalogMetadata();
    return { items: normalizeHotWords((metadata.hot || []).map(tag => ({ word: tag.name }))) };
  });
  const [offset, setOffset] = useState(0);
  const items = words.data?.items?.filter((item) => item.word) || [];
  const visible = items.length ? Array.from({ length: Math.min(4, items.length) }, (_, index) => items[(offset + index) % items.length]) : [];
  return <section className="ref-guess-section" aria-label="猜你想搜"><div className="ref-section-heading"><h2>猜你想搜</h2>
    <button disabled={items.length <= 4} onClick={() => setOffset((value) => (value + 4) % items.length)}><IRefresh size={14} />换一批</button></div>
    <div className="ref-guess-words">{visible.map((item) => <button key={item.word} onClick={() => requestSearch(item.word)}><ISearch size={14} /><span className="ref-hot-word" title={item.word}>{item.word}</span><small>{fmt(item.heat)}</small></button>)}
      {!items.length && <span>{words.loading ? "正在加载热搜" : words.error ? "热搜暂时无法加载" : "暂无热搜"}</span>}
      {words.error && <button onClick={words.reload}>重试热搜</button>}
    </div></section>;
}

export function TopicGrid({ items }: { items: Topic[] }) {
  const { push } = useStore();
  return <div className="ref-topic-grid">{items.map((topic) => <button key={topic.id || topic.slug} className="ref-topic-card" data-topic-slug={topic.slug}
    onClick={() => push({ kind: "topic", slug: topic.slug, title: topic.title })}>
    <div className="ref-topic-cover"><Img src={topic.cover} alt={topic.title} /><span>{topic.video_count || 0} 部作品</span></div>
    <h3>{topic.title}</h3><p>{topic.intro?.replace(/<[^>]*>/g, " ")}</p>
  </button>)}</div>;
}

export function VideoBrowser({ section, tag, title, active = true, wide = true, onBack }: {
  section?: Exclude<DiscoverySection, "topics" | "posts">; tag?: string; title?: string; active?: boolean; wide?: boolean; onBack?: () => void;
}) {
  const { push } = useStore();
  const [priority, setPriority] = useState(false);
  const [originalChannel, setOriginalChannel] = useState<DiscoveryVideoSection>("original");
  const list = usePaged((page) => tag ? api.tag(tag, page) : api.discover(section === "original" ? originalChannel : section || "recommend", page), [section, tag, originalChannel]);
  const videos = orderByScore(list.items, priority);
  const name = title || DISCOVERY_SECTIONS.find((item) => item.value === section)?.label || "作品";
  return <section className="ref-discovery-results" aria-label={name} aria-busy={list.loading}>
    <div className="ref-section-heading ref-results-heading"><div>{onBack && <button aria-label="返回" onClick={onBack}><IBack size={18} /></button>}<h2>{name}</h2><span>已加载 {list.items.length} 部</span></div>
      <div className="ref-heading-actions"><ScoreSort priority={priority} onChange={setPriority} /><CatalogViewSwitch /><button disabled={list.loading} onClick={list.reset}><IRefresh size={14} />刷新</button></div></div>
    {section === "original" && <div className="ref-discovery-tabs" role="group" aria-label="原创分类">{[{ value: "original", label: "全部原创" }, { value: "original-short", label: "原创短剧" }, { value: "original-comic", label: "原创漫剧" }].map((item) => <button key={item.value} aria-pressed={originalChannel === item.value} onClick={() => setOriginalChannel(item.value as DiscoveryVideoSection)}>{item.label}</button>)}</div>}
    <ScoreSortNote priority={priority} />
    {videos.length ? <Masonry videos={videos} tools={false} wide={wide} onOpen={(item) => push({ kind: "feed", videoIds: videos.map((video) => video.id), index: videos.findIndex((video) => video.id === item.id), title: name })} />
      : list.loading ? <CatalogSkeleton wide={wide} /> : <Empty icon={<ISearch size={25} />} title={list.error ? `${name}加载失败` : "暂无作品"} sub={list.error || "稍后再来看看"} action={list.error ? "重试" : undefined} onAction={list.reset} />}
    {!!list.items.length && <LoadMore loading={list.loading} error={list.error} hasMore={list.hasMore} count={list.items.length} onLoad={list.loadMore} automatic={active} />}
  </section>;
}

export function TopicsBrowser({ active = true }: { active?: boolean }) {
  const list = usePaged((page) => api.topics(page));
  return <section aria-label="专题合集" aria-busy={list.loading}><div className="ref-section-heading"><h2>专题合集</h2><button disabled={list.loading} onClick={list.reset}><IRefresh size={14} />刷新</button></div>
    {list.items.length ? <TopicGrid items={list.items} /> : list.loading ? <CatalogSkeleton /> : <Empty icon={<ISearch size={25} />} title={list.error ? "专题加载失败" : "暂无专题"} sub={list.error || undefined} action={list.error ? "重试" : undefined} onAction={list.reset} />}
    {!!list.items.length && <LoadMore loading={list.loading} error={list.error} hasMore={list.hasMore} count={list.items.length} onLoad={list.loadMore} automatic={active} />}
  </section>;
}

export function ArticlesBrowser({ active = true }: { active?: boolean }) {
  const { push } = useStore(), categories = useAsync(() => api.postCategories());
  const [category, setCategory] = useState("");
  const list = usePaged((page) => api.discoverPosts(category, page), [category]);
  return <section aria-label="图文社区" aria-busy={list.loading}>
    <div className="ref-section-heading"><h2>图文社区</h2><button disabled={list.loading} onClick={list.reset}><IRefresh size={14} />刷新</button></div>
    <div className="ref-discovery-tabs ref-article-tabs" role="group" aria-label="图文分类"><button aria-pressed={!category} onClick={() => setCategory("")}>全部图文</button>
      {(categories.data?.items || []).map((item) => <button key={item.route} aria-pressed={category === item.route} onClick={() => setCategory(item.route)}>{item.name}</button>)}</div>
    {categories.error && <div className="ref-inline-error">图文分类加载失败<button onClick={categories.reload}>重试分类</button></div>}
    {list.items.length ? <div className="ref-article-grid">{list.items.map((post) => <button key={post.id} className="ref-article-card" onClick={() => push({ kind: "post", id: post.id })}>
      <div className="ref-article-cover"><Img src={post.cover} alt={post.title} /></div><div><small>{post.publish_time || post.created_at || "图文"} · {fmt(post.hot)} 热度</small><h3>{post.title}</h3><p>{post.desc?.replace(/<[^>]*>/g, " ")}</p><span>阅读详情 ›</span></div>
    </button>)}</div> : list.loading ? <CatalogSkeleton /> : <Empty icon={<ISearch size={25} />} title={list.error ? "图文加载失败" : "当前分类暂无图文"} sub={list.error || undefined} action={list.error ? "重试" : undefined} onAction={list.reset} />}
    {!!list.items.length && <LoadMore loading={list.loading} error={list.error} hasMore={list.hasMore} count={list.items.length} onLoad={list.loadMore} automatic={active} />}
  </section>;
}

export function TopicPage(props: { slug: string; title: string; onBack: () => void; active: boolean; wide: boolean }) {
  return <TopicContent key={props.slug} {...props} />;
}
function TopicContent({ slug, title, onBack, active, wide }: { slug: string; title: string; onBack: () => void; active: boolean; wide: boolean }) {
  const { push } = useStore(), alive = useRef(true);
  const [priority, setPriority] = useState(false);
  const [detail, setDetail] = useState<TopicDetail | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const list = usePaged(async (page) => { const data = await api.topic(slug, page); if (alive.current) setDetail(data); return data.videos; });
  const videos = orderByScore(list.items, priority);
  return <div className="absolute inset-0 scroll-y ref-page-scroll"><section className="ref-discovery-page" aria-label="专题详情" aria-busy={list.loading}>
    <div className="ref-section-heading"><div className="ref-heading-actions"><button aria-label="返回" onClick={onBack}><IBack size={18} /></button><h2>{detail?.topic.title || title}</h2></div><button disabled={list.loading} onClick={list.reset}><IRefresh size={14} />刷新</button></div>
    {detail && <div className="ref-topic-intro"><div><Img src={detail.topic.cover} alt="" /></div><p>{detail.topic.intro?.replace(/<[^>]*>/g, " ")}</p><span>{detail.topic.video_count} 部作品</span></div>}
    <div className="ref-section-heading"><h2>专题作品</h2><div className="ref-heading-actions"><ScoreSort priority={priority} onChange={setPriority} /><CatalogViewSwitch /></div></div>
    <ScoreSortNote priority={priority} />
    {videos.length ? <Masonry videos={videos} tools={false} wide={wide} onOpen={(item) => push({ kind: "feed", videoIds: videos.map((video) => video.id), index: videos.findIndex((video) => video.id === item.id), title: detail?.topic.title || title })} />
      : list.loading ? <CatalogSkeleton wide={wide} /> : <Empty icon={<ISearch size={25} />} title={list.error ? "专题加载失败" : "专题暂无作品"} sub={list.error || undefined} action={list.error ? "重试" : undefined} onAction={list.reset} />}
    {!!list.items.length && <LoadMore loading={list.loading} error={list.error} hasMore={list.hasMore} count={list.items.length} onLoad={list.loadMore} automatic={active} />}
    {!!detail?.topic.faq?.length && <section className="ref-topic-faq"><h2>关于这个专题</h2>{detail.topic.faq.map((item, index) => <details key={index}><summary>{item.q}</summary><p>{item.a}</p></details>)}</section>}
    {!!detail?.related.length && <section><div className="ref-section-heading"><h2>相关专题</h2></div><TopicGrid items={detail.related} /></section>}
  </section></div>;
}

export function TagPage({ slug, title, onBack, active, wide }: { slug: string; title: string; onBack: () => void; active: boolean; wide: boolean }) {
  return <div className="absolute inset-0 scroll-y ref-page-scroll"><div className="ref-discovery-page"><VideoBrowser tag={slug} title={title} onBack={onBack} active={active} wide={wide} /></div></div>;
}

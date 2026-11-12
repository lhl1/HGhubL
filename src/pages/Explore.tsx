import { useLayoutEffect, useRef } from "react";
import { useStore } from "../store";
import { DISCOVERY_SECTIONS } from "../discovery";
import { ArticlesBrowser, HotWords, TopicsBrowser, VideoBrowser } from "../components/DiscoveryContent";
import { IGrid, IRefresh, ITrophy } from "../icons";

export default function Explore({ active, wide }: { active: boolean; wide: boolean }) {
  const { discoverySection: section, openExplore, setTab, push } = useStore();
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [section]);
  return <div ref={scroll} className="absolute inset-0 scroll-y ref-page-scroll"><section className="ref-discovery-page">
    <div className="ref-explore-shortcuts"><button onClick={() => push({ kind: "ranks" })}><ITrophy size={19} />排行榜</button>
      <button onClick={() => openExplore("latest")}><IRefresh size={18} />上新</button><button onClick={() => setTab("category")}><IGrid size={19} />分类筛选</button></div>
    <HotWords />
    <header className="ref-discovery-heading"><div><span className="ref-eyebrow">HGhub 探索</span><h2>发现更多故事</h2><p>{DISCOVERY_SECTIONS.find((item) => item.value === section)?.intro}</p></div></header>
    <nav className="ref-discovery-tabs" aria-label="探索分区">{DISCOVERY_SECTIONS.map((item) => <button key={item.value} aria-current={section === item.value ? "page" : undefined} onClick={() => openExplore(item.value)}>{item.label}</button>)}</nav>
    {section === "topics" ? <TopicsBrowser key={section} active={active} /> : section === "posts" ? <ArticlesBrowser key={section} active={active} /> : <VideoBrowser key={section} section={section} active={active} wide={wide} />}
  </section></div>;
}

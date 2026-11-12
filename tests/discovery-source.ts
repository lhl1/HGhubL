import { homeData, topicData, videoPage } from "../src/discovery";

// Optional integration check against locally captured public pages, not user data.
// The snapshot helper exposes only named files on 127.0.0.1:1421.
const checks: string[] = [];
const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
try {
  const source = async (name: string) => { const response = await fetch(`http://127.0.0.1:1421/${name}`); if (!response.ok) throw new Error(`Snapshot ${name} unavailable`); return response.json(); };
  const home = homeData(await source("home"));
  assert(home.banners.length > 0 && home.banners.every((item) => item.video_id > 0 && item.image.startsWith("https://")), "actual homepage hero imports playable video IDs and covers");
  assert(home.featured.length > 0 && home.latest.length > 0 && (home.hot?.length || 0) > 0, "actual homepage imports all current video sections");
  assert(home.topic_rec.length > 0 && home.topic_rec.every((item) => item.slug && item.title), "actual homepage topic cards keep native detail destinations");
  assert((home.hot_tags?.length || 0) > 0 && home.hot_tags!.every((tag) => tag.slug && tag.name), "actual homepage popular tags remain available without the failing metadata endpoint");
  for (const section of ["original", "recommend", "latest", "short"]) {
    const page = videoPage(await source(section));
    assert(page.items.length > 0 && page.items.every((item) => item.id > 0 && item.title && item.cover.startsWith("https://")), `${section} actual web cards import their own video identities and covers`);
    assert(page.pagination.pages > 1 && page.items.every((item) => item.episode_count > 0), `${section} actual web page counts and episodes remain available`);
  }
  const detail = topicData(await source("topic"), "hot-aiduanju");
  assert(detail.topic.title !== "专题" && detail.topic.intro.length > 0 && detail.topic.video_count > 0, "actual topic metadata imports its title, introduction and collection count");
  assert(detail.videos.items.length > 0 && detail.related.length > 0, "actual topic details include member videos and related native topics");
  assert(!document.querySelector("iframe,img,link,script[src^='https:']"), "actual source documents remain inert after extraction");
  document.querySelector("#results")!.textContent = JSON.stringify({ passed: true, count: checks.length, checks }, null, 2);
} catch (error) { document.querySelector("#results")!.textContent = JSON.stringify({ passed: false, checks, error: String(error) }, null, 2); }

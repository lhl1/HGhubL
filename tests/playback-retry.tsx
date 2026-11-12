import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { api, LOCAL } from "../src/api";
import { AppProvider } from "../src/store";
import Feed from "../src/components/Feed";
import type { Detail, PlayInfo } from "../src/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const checks: string[] = [];
const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
const original = { boot: api.boot, video: api.video, play: api.play };
const requests: { id: number; resolve: (info: PlayInfo) => void }[] = [];
const root = createRoot(document.querySelector("#fixture")!);
const info = (id: number): PlayInfo => ({ id, ep_num: 1, duration: 20, title: "fixture", video_url: `${LOCAL}/seg?u=https%3A%2F%2Fcdn.example%2F${id}.mp4` });
const render = (id: number) => root.render(<AppProvider><Feed videoIds={[id]} mode="home" active bottomInset={0} /></AppProvider>);
try {
  api.boot = async () => ({ user: null, logged_in: false, base: "https://huangguoai.com" });
  api.video = async (id) => ({ id, title: "fixture", cover: "", episodes: [], tags: [], counts: {}, author: {} } as unknown as Detail);
  api.play = (id) => {
    if (!requests.length) {
      requests.push({ id, resolve: () => {} });
      return Promise.reject(new Error("fixture: address unavailable"));
    }
    return new Promise<PlayInfo>((resolve) => requests.push({ id, resolve }));
  };
  await act(async () => render(101));
  assert(document.body.textContent?.includes("fixture: address unavailable"), "address failure is visible");
  assert(!document.querySelector("video"), "address failure does not mount a player");
  const retry = [...document.querySelectorAll("button")].find((button) => button.textContent === "重试");
  assert(retry, "retry action is available without a player");
  await act(async () => retry!.click());
  assert(requests.length === 2 && requests[1].id === 101, "retry requests a fresh playback address");
  await act(async () => render(202));
  assert(requests.length === 3 && requests[2].id === 202, "switching video requests its own address");
  await act(async () => requests[1].resolve(info(101)));
  assert(!document.querySelector("video"), "late previous request cannot mount a stale player");
  await act(async () => requests[2].resolve(info(202)));
  assert(document.querySelector("video")?.src === info(202).video_url, "current response mounts the current video");
  await act(async () => render(101));
  assert(requests.length === 4 && requests[3].id === 101, "returning to a video renews its signed address");
  document.querySelector("#results")!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
} catch (error) {
  document.querySelector("#results")!.textContent = JSON.stringify({ passed: checks.length, failed: 1, error: String(error), checks });
} finally {
  await act(async () => root.unmount());
  Object.assign(api, original);
}

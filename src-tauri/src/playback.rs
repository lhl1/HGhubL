//! Current upstream playback transport, matching the public site's playback service.
//! Signed URLs and ephemeral encryption keys stay in memory only.
use crate::edge_crypto::{self, EdgeScope};
use base64::{engine::general_purpose::STANDARD, Engine};
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

const PREFETCH_TTL: Duration = Duration::from_secs(90);
const PREFETCH_MAX: usize = 16;

#[derive(Clone)]
struct Prefetched {
    token: Option<String>,
    expires: Instant,
    data: Value,
}

static PREFETCHED: Lazy<Mutex<HashMap<(String, i64, u32), Prefetched>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn take_prefetched(origin: &str, id: i64, ep: u32, token: Option<&str>) -> Option<Value> {
    let mut map = PREFETCHED.lock().ok()?;
    let now = Instant::now();
    map.retain(|_, v| v.expires > now);
    let key = (origin.to_string(), id, ep);
    let matches = map
        .get(&key)
        .is_some_and(|v| v.token.as_deref() == token);
    if matches {
        map.remove(&key).map(|v| v.data)
    } else {
        None
    }
}

fn store_prefetched(origin: &str, id: i64, ep: u32, token: Option<&str>, data: Value) {
    if let Ok(mut map) = PREFETCHED.lock() {
        let now = Instant::now();
        map.retain(|_, v| v.expires > now);
        if map.len() >= PREFETCH_MAX {
            map.clear();
        }
        map.insert(
            (origin.to_string(), id, ep),
            Prefetched {
                token: token.map(str::to_string),
                expires: now + PREFETCH_TTL,
                data,
            },
        );
    }
}

fn has_prefetched(origin: &str, id: i64, ep: u32, token: Option<&str>) -> bool {
    PREFETCHED.lock().ok().is_some_and(|map| {
        let now = Instant::now();
        map.get(&(origin.to_string(), id, ep))
            .is_some_and(|v| v.expires > now && v.token.as_deref() == token)
    })
}

async fn fetch_video(
    origin: &str,
    id: i64,
    ep: u32,
    token: Option<&str>,
) -> Result<Value, String> {
    let path = format!("/api/videos/{id}/episodes/{ep}/playback");
    let encoded = STANDARD.encode(b"{}");
    let env = edge_crypto::request(
        origin,
        EdgeScope::Playback,
        "POST",
        &path,
        &encoded,
        "application/json",
        token,
    )
    .await
    .map_err(|e| e.into_message())?;

    if !(200..300).contains(&env.status) {
        return Err(format!("播放接口返回 HTTP {}", env.status));
    }
    let value: Value =
        serde_json::from_slice(&env.body).map_err(|_| "播放数据格式无效".to_string())?;
    if value["status"] != 1 {
        return Err(value["msg"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or("获取播放地址失败")
            .into());
    }
    normalize(value["data"].clone(), id, ep)
}

pub(crate) async fn video(
    origin: &str,
    id: i64,
    ep: u32,
    token: Option<&str>,
) -> Result<Value, String> {
    if id <= 0 || ep == 0 || ep > i32::MAX as u32 {
        return Err("无效的视频或分集编号".into());
    }
    let origin = crate::net::normalize_base(origin).ok_or("播放请求必须使用安全 HTTPS 线路")?;
    if crate::network_policy::strict_security()
        && token.is_some()
        && !crate::net::trusted_auth_origin(&origin)
    {
        return Err("镜像线路仅供游客浏览；登录请切换到固定线路".into());
    }
    if let Some(hit) = take_prefetched(&origin, id, ep, token) {
        return Ok(hit);
    }
    fetch_video(&origin, id, ep, token).await
}

/// 后台预取下一集 / 下一部的播放地址并预热 HLS 首帧分片（单次消费，不影响返回重取新签名）。
pub(crate) async fn prewarm(origin: &str, id: i64, ep: u32, token: Option<&str>) {
    if id <= 0 || ep == 0 || ep > i32::MAX as u32 {
        return;
    }
    let Some(origin) = crate::net::normalize_base(origin) else {
        return;
    };
    if crate::network_policy::strict_security()
        && token.is_some()
        && !crate::net::trusted_auth_origin(&origin)
    {
        return;
    }
    if has_prefetched(&origin, id, ep, token) {
        return;
    }
    let Ok(data) = fetch_video(&origin, id, ep, token).await else {
        return;
    };
    let url = data["video_url"].as_str().unwrap_or("").to_string();
    store_prefetched(&origin, id, ep, token, data);
    if url.to_ascii_lowercase().contains(".m3u8") {
        crate::media::prewarm_hls(&url, crate::media::LOCAL_ORIGIN).await;
    }
}

fn normalize(data: Value, id: i64, ep: u32) -> Result<Value, String> {
    if data["manifest_method"] != "GET" {
        return Err("不支持的播放清单请求方式".into());
    }
    let main = data["streams"]
        .get("main")
        .and_then(Value::as_str)
        .ok_or_else(|| "播放响应缺少 main".to_string())?;
    if main.trim().is_empty() {
        return Err("上游暂未提供本集播放地址，请稍后重试".into());
    }
    crate::network_policy::parse_target(main)?;
    Ok(json!({
        "id": id,
        "ep_num": ep,
        "duration": 0,
        "title": "",
        "video_url": main,
        "video_url_hevc": data["streams"]["hevc"].as_str().unwrap_or(""),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playback_shape_and_target_validation() {
        let data = json!({"manifest_method":"GET", "streams":{"main":"https://cdn.example/test.m3u8?auth_key=test", "hevc":""}});
        let result = normalize(data.clone(), 117, 3).unwrap();
        assert_eq!(result["ep_num"], 3);
        assert_eq!(result["video_url"], data["streams"]["main"]);
        for target in [
            "",
            "javascript:alert(1)",
            "http://127.0.0.1/test",
            "file:///C:/secret",
        ] {
            let mut invalid = data.clone();
            invalid["streams"]["main"] = json!(target);
            assert!(normalize(invalid, 117, 3).is_err());
        }
        assert!(normalize(json!({"manifest_method":"POST"}), 117, 3).is_err());
    }

    #[test]
    fn prefetch_is_single_use_and_isolated_by_origin_and_token() {
        let origin = "https://huangguoai.com";
        let payload = json!({"id": 77, "ep_num": 2, "video_url": "https://cdn.example/77-2.m3u8"});
        store_prefetched(origin, 77, 2, Some("tok-a"), payload.clone());
        assert!(take_prefetched("https://huangguodrama.io", 77, 2, Some("tok-a")).is_none());
        assert!(take_prefetched(origin, 77, 2, Some("tok-b")).is_none());
        assert!(take_prefetched(origin, 77, 2, None).is_none());
        assert_eq!(
            take_prefetched(origin, 77, 2, Some("tok-a")).unwrap(),
            payload
        );
        // 单次消费后再次进入会重新获取签名地址
        assert!(take_prefetched(origin, 77, 2, Some("tok-a")).is_none());
    }

    #[tokio::test]
    async fn invalid_requests_rejected_without_network() {
        assert!(video("https://huangguoai.com", -1, 1, None).await.is_err());
        assert!(video("https://huangguoai.com", 1, 0, None).await.is_err());
        assert!(video("https://mirror.invalid", 1, 1, Some("secret"))
            .await
            .unwrap_err()
            .contains("镜像线路"));
    }

    #[tokio::test]
    #[ignore = "Live playback smoke: API, manifest rewrite, AES key and one segment"]
    async fn live_playback() {
        let id = std::env::var("HGHUB_TEST_VIDEO_ID")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(117);
        let ep = std::env::var("HGHUB_TEST_EP")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(3);
        let info = video(crate::net::DEFAULT_BASE, id, ep, None)
            .await
            .expect("playback API");
        let playlist = crate::media::load_playlist(
            info["video_url"].as_str().unwrap(),
            crate::media::LOCAL_ORIGIN,
        )
        .await
        .expect("playlist");
        assert!(playlist.starts_with("#EXTM3U"));
        let key_line = playlist
            .lines()
            .find(|line| line.starts_with("#EXT-X-KEY"))
            .expect("key line");
        let key_url = key_line
            .split("URI=\"")
            .nth(1)
            .unwrap()
            .split('"')
            .next()
            .unwrap();
        let key = crate::media::handle(
            "/seg",
            key_url.split_once('?').unwrap().1,
            crate::media::LOCAL_ORIGIN,
        )
        .await;
        assert_eq!(key.status(), 200);
        assert_eq!(key.body().len(), 16);
        let segment = playlist
            .lines()
            .find(|line| !line.starts_with('#') && line.contains("/seg?u="))
            .expect("segment");
        let segment = crate::media::handle(
            "/seg",
            segment.split_once('?').unwrap().1,
            crate::media::LOCAL_ORIGIN,
        )
        .await;
        assert_eq!(segment.status(), 200);
        assert!(segment.body().len() > 1000);
        println!("API + HLS rewrite + 16-byte AES key + media segment OK (video {id}, ep {ep})");
    }
}

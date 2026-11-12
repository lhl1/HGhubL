//! Current upstream playback transport, matching the public site's playback service.
//! Signed URLs and ephemeral encryption keys stay in memory only.
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use once_cell::sync::Lazy;
use ring::{aead, agreement, hkdf, rand::SystemRandom};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;

static SESSIONS: Lazy<Mutex<HashMap<String, Session>>> = Lazy::new(|| Mutex::new(HashMap::new()));
const MAX_SEQUENCE: u32 = 16384;

struct Session {
    kid: String,
    sid: String,
    info: String,
    request_key: aead::LessSafeKey,
    response_key: aead::LessSafeKey,
    sequence: u32,
    clock_offset: i64,
    expires: Instant,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn field<'a>(value: &'a Value, name: &str) -> Result<&'a str, String> {
    value
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("播放响应缺少 {name}"))
}

fn identifier(value: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

fn derive(prk: &hkdf::Prk, info: &str) -> Result<aead::LessSafeKey, String> {
    let parts = [info.as_bytes()];
    let okm = prk
        .expand(&parts, hkdf::HKDF_SHA256)
        .map_err(|_| "播放密钥派生失败")?;
    let mut key = [0u8; 32];
    okm.fill(&mut key).map_err(|_| "播放密钥派生失败")?;
    let key = aead::UnboundKey::new(&aead::AES_256_GCM, &key).map_err(|_| "播放密钥无效")?;
    Ok(aead::LessSafeKey::new(key))
}

impl Session {
    async fn open(origin: &str) -> Result<Self, String> {
        let secret =
            agreement::EphemeralPrivateKey::generate(&agreement::ECDH_P256, &SystemRandom::new())
                .map_err(|_| "无法创建播放会话")?;
        let public = secret
            .compute_public_key()
            .map_err(|_| "无法创建播放公钥")?;
        let hello = crate::net::playback_packet(
            origin,
            &json!({
                "v": 1, "type": "hello", "client_pub": URL_SAFE_NO_PAD.encode(public.as_ref()),
            }),
        )
        .await?;
        let kid = field(&hello, "kid")?;
        let sid = field(&hello, "sid")?;
        let site = field(&hello, "site")?;
        let server_time = hello["server_time"].as_i64().ok_or("播放握手时间无效")?;
        let ttl = hello["expires_at"]
            .as_i64()
            .and_then(|expires| expires.checked_sub(server_time))
            .filter(|ttl| (6..=600).contains(ttl))
            .ok_or("播放会话有效期无效")?;
        if hello["v"] != 1
            || hello["type"] != "hello"
            || !identifier(kid, 1, 64)
            || !identifier(sid, 16, 128)
            || site.is_empty()
            || site.len() > 256
            || !site
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b".:[]-".contains(&c))
        {
            return Err("播放握手响应无效".into());
        }
        let salt = URL_SAFE_NO_PAD
            .decode(field(&hello, "salt")?)
            .map_err(|_| "播放握手编码无效")?;
        if salt.len() != 32 {
            return Err("播放握手盐值无效".into());
        }
        let remote = URL_SAFE_NO_PAD
            .decode(field(&hello, "server_pub")?)
            .map_err(|_| "播放公钥编码无效")?;
        let peer = agreement::UnparsedPublicKey::new(&agreement::ECDH_P256, remote);
        let info = format!("dx150-edge-v1\nplayback\n{site}\n{kid}\n{sid}");
        let (request_key, response_key) = agreement::agree_ephemeral(secret, &peer, |shared| {
            let prk = hkdf::Salt::new(hkdf::HKDF_SHA256, &salt).extract(shared);
            Ok::<_, String>((
                derive(&prk, &format!("{info}\nreq"))?,
                derive(&prk, &format!("{info}\nres"))?,
            ))
        })
        .map_err(|_| "播放密钥协商失败")??;
        let clock_offset = server_time.checked_sub(now()).ok_or("播放握手时间无效")?;
        Ok(Self {
            kid: kid.into(),
            sid: sid.into(),
            info,
            request_key,
            response_key,
            sequence: 0,
            clock_offset,
            expires: Instant::now() + Duration::from_secs((ttl - 5) as u64),
        })
    }

    fn nonce(&self) -> aead::Nonce {
        let mut nonce = [0u8; 12];
        nonce[8..].copy_from_slice(&self.sequence.to_be_bytes());
        aead::Nonce::assume_unique_for_key(nonce)
    }

    fn aad(&self, direction: &str, timestamp: i64) -> Vec<u8> {
        format!("{}\n{direction}\n{}\n{timestamp}", self.info, self.sequence).into_bytes()
    }

    async fn call(
        &mut self,
        origin: &str,
        path: &str,
        token: Option<&str>,
    ) -> Result<Value, String> {
        self.sequence += 1;
        let timestamp = now()
            .checked_add(self.clock_offset)
            .ok_or("播放会话时间无效")?;
        let mut packet = json!({"request": {
            "method": "POST", "path": path, "body": STANDARD.encode(b"{}"), "content_type": "application/json",
        }});
        if let Some(token) = token.filter(|s| !s.is_empty()) {
            packet["authorization"] = json!(format!("Bearer {token}"));
        }
        let mut ciphertext = serde_json::to_vec(&packet).map_err(|_| "播放请求编码失败")?;
        self.request_key
            .seal_in_place_append_tag(
                self.nonce(),
                aead::Aad::from(self.aad("req", timestamp)),
                &mut ciphertext,
            )
            .map_err(|_| "播放请求加密失败")?;
        let result = crate::net::playback_packet(origin, &json!({
            "v": 1, "type": "call", "kid": self.kid, "sid": self.sid, "seq": self.sequence, "ts": timestamp,
            "ciphertext": URL_SAFE_NO_PAD.encode(ciphertext),
        })).await?;
        self.decode(result, timestamp)
    }

    fn decode(&self, result: Value, timestamp: i64) -> Result<Value, String> {
        if result["v"] != 1
            || result["type"] != "result"
            || result["kid"] != self.kid
            || result["sid"] != self.sid
            || result["seq"] != self.sequence
            || result["ts"] != timestamp
        {
            return Err("播放通道响应不匹配".into());
        }
        let mut bytes = URL_SAFE_NO_PAD
            .decode(field(&result, "ciphertext")?)
            .map_err(|_| "播放响应编码无效")?;
        let plain = self
            .response_key
            .open_in_place(
                self.nonce(),
                aead::Aad::from(self.aad("res", timestamp)),
                &mut bytes,
            )
            .map_err(|_| "播放响应校验失败")?;
        let inner: Value = serde_json::from_slice(plain).map_err(|_| "播放响应格式无效")?;
        let status = inner["status"].as_u64().ok_or("播放响应缺少状态码")?;
        if !(200..300).contains(&status) {
            return Err(format!("播放接口返回 HTTP {status}"));
        }
        let body = STANDARD
            .decode(field(&inner, "body")?)
            .map_err(|_| "播放数据编码无效")?;
        let value: Value = serde_json::from_slice(&body).map_err(|_| "播放数据格式无效")?;
        if value["status"] != 1 {
            return Err(value["msg"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or("获取播放地址失败")
                .into());
        }
        Ok(value["data"].clone())
    }
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
    let mut sessions = SESSIONS.lock().await;
    if sessions
        .get(&origin)
        .is_none_or(|s| s.expires <= Instant::now() || s.sequence >= MAX_SEQUENCE)
    {
        sessions.remove(&origin);
        // Bound the in-memory cache when switching through many mirror origins.
        if sessions.len() >= 4 {
            sessions.clear();
        }
        sessions.insert(origin.clone(), Session::open(&origin).await?);
    }
    let result = sessions
        .get_mut(&origin)
        .unwrap()
        .call(
            &origin,
            &format!("/api/videos/{id}/episodes/{ep}/playback"),
            token,
        )
        .await;
    if result.is_err() {
        sessions.remove(&origin);
    }
    normalize(result?, id, ep)
}

fn normalize(data: Value, id: i64, ep: u32) -> Result<Value, String> {
    if data["manifest_method"] != "GET" {
        return Err("不支持的播放清单请求方式".into());
    }
    let main = field(&data["streams"], "main")?;
    if main.trim().is_empty() {
        return Err("上游暂未提供本集播放地址，请稍后重试".into());
    }
    crate::network_policy::parse_target(main)?;
    Ok(
        json!({"id": id, "ep_num": ep, "duration": 0, "title": "", "video_url": main,
        "video_url_hevc": data["streams"]["hevc"].as_str().unwrap_or("")}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Session {
        let key =
            || aead::LessSafeKey::new(aead::UnboundKey::new(&aead::AES_256_GCM, &[9; 32]).unwrap());
        Session {
            kid: "test".into(),
            sid: "test-session-123456".into(),
            info: "fixture".into(),
            request_key: key(),
            response_key: key(),
            sequence: 1,
            clock_offset: 0,
            expires: Instant::now() + Duration::from_secs(60),
        }
    }

    fn response(session: &Session) -> Value {
        let body =
            json!({"status": 1, "data": {"streams": {"main": "https://cdn.example/test.m3u8"}}});
        let mut bytes = serde_json::to_vec(&json!({"status": 200, "headers": {},
            "body": STANDARD.encode(serde_json::to_vec(&body).unwrap())}))
        .unwrap();
        session
            .response_key
            .seal_in_place_append_tag(
                session.nonce(),
                aead::Aad::from(session.aad("res", 123)),
                &mut bytes,
            )
            .unwrap();
        json!({"v":1, "type":"result", "kid":session.kid, "sid":session.sid, "seq":1, "ts":123,
            "ciphertext":URL_SAFE_NO_PAD.encode(bytes)})
    }

    #[test]
    fn authenticated_response_and_packet_binding() {
        let session = fixture();
        let packet = response(&session);
        assert_eq!(
            session.decode(packet.clone(), 123).unwrap()["streams"]["main"],
            "https://cdn.example/test.m3u8"
        );
        for (field, value) in [
            ("v", json!(2)),
            ("type", json!("hello")),
            ("kid", json!("other")),
            ("sid", json!("other-session")),
            ("seq", json!(2)),
            ("ts", json!(124)),
        ] {
            let mut changed = packet.clone();
            changed[field] = value;
            assert!(session.decode(changed, 123).is_err(), "must bind {field}");
        }
        let mut changed = packet;
        let mut bytes = URL_SAFE_NO_PAD
            .decode(changed["ciphertext"].as_str().unwrap())
            .unwrap();
        bytes[0] ^= 1;
        changed["ciphertext"] = json!(URL_SAFE_NO_PAD.encode(bytes));
        assert!(session.decode(changed, 123).is_err());
    }

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

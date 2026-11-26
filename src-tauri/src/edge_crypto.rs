//! 上游 `dx150-edge-v1` 加密接口通道（ECDH P-256 + HKDF-SHA256 + AES-256-GCM）。
//!
//! 站点在 2026-11-25 停用了旧 `/api/edge/request`，把业务接口拆分到四个作用域：
//! `public` / `dynamic` / `playback` / `user`。本模块统一维护各作用域的临时会话与加解密。

use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use once_cell::sync::Lazy;
use ring::{aead, agreement, hkdf, rand::SystemRandom};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const MAX_SEQUENCE: u32 = 16384;
const MAX_CACHED_SESSIONS: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum EdgeScope {
    Public,
    Dynamic,
    Playback,
    User,
}

impl EdgeScope {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Public => "public",
            Self::Dynamic => "dynamic",
            Self::Playback => "playback",
            Self::User => "user",
        }
    }

    pub const fn endpoint(self) -> &'static str {
        match self {
            Self::Public => "/api/public/request",
            Self::Dynamic => "/api/dynamic/request",
            Self::Playback => "/api/playback/request",
            Self::User => "/api/user/request",
        }
    }
}

#[derive(Debug)]
pub enum CallError {
    /// 服务端尚未执行内层业务即拒绝了加密信封（如 `session_expired`），可重建会话重试。
    SessionExpired(String),
    /// 传输层 / 5xx / 超时等可按需重试的错误。
    Transient(String),
    /// 401/403、业务校验失败、本地安全策略拒绝等不可通过重试解决的错误。
    Fatal(String),
}

impl CallError {
    pub fn into_message(self) -> String {
        match self {
            Self::SessionExpired(m) | Self::Transient(m) | Self::Fatal(m) => m,
        }
    }

    pub fn is_retryable(&self) -> bool {
        matches!(self, Self::SessionExpired(_) | Self::Transient(_))
    }
}

pub struct Session {
    scope: EdgeScope,
    kid: String,
    sid: String,
    info: String,
    request_key: aead::LessSafeKey,
    response_key: aead::LessSafeKey,
    sequence: AtomicU32,
    clock_offset: i64,
    expires: Instant,
}

type SessionKey = (String, EdgeScope);
static SESSIONS: Lazy<Mutex<HashMap<SessionKey, Arc<Session>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static OPEN_LOCKS: Lazy<Mutex<HashMap<SessionKey, std::sync::Weak<tokio::sync::Mutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn open_lock(key: &SessionKey) -> Arc<tokio::sync::Mutex<()>> {
    let mut locks = OPEN_LOCKS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(existing) = locks.get(key).and_then(std::sync::Weak::upgrade) {
        return existing;
    }
    locks.retain(|_, w| w.strong_count() > 0);
    let lock = Arc::new(tokio::sync::Mutex::new(()));
    locks.insert(key.clone(), Arc::downgrade(&lock));
    lock
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
        .ok_or_else(|| format!("加密接口响应缺少 {name}"))
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
        .map_err(|_| "加密密钥派生失败")?;
    let mut key = [0u8; 32];
    okm.fill(&mut key).map_err(|_| "加密密钥派生失败")?;
    let key = aead::UnboundKey::new(&aead::AES_256_GCM, &key).map_err(|_| "加密密钥无效")?;
    Ok(aead::LessSafeKey::new(key))
}

fn nonce_for(sequence: u32) -> aead::Nonce {
    let mut nonce = [0u8; 12];
    nonce[8..].copy_from_slice(&sequence.to_be_bytes());
    aead::Nonce::assume_unique_for_key(nonce)
}

fn aad_for(info: &str, direction: &str, sequence: u32, timestamp: i64) -> Vec<u8> {
    format!("{info}\n{direction}\n{sequence}\n{timestamp}").into_bytes()
}

pub struct DecryptedEnvelope {
    pub status: u16,
    pub body: Vec<u8>,
}

impl Session {
    async fn open(origin: &str, scope: EdgeScope) -> Result<Self, CallError> {
        let secret =
            agreement::EphemeralPrivateKey::generate(&agreement::ECDH_P256, &SystemRandom::new())
                .map_err(|_| CallError::Fatal("无法创建加密会话".into()))?;
        let public = secret
            .compute_public_key()
            .map_err(|_| CallError::Fatal("无法创建加密公钥".into()))?;
        let (http_status, hello) = crate::net::scope_packet(
            origin,
            scope.endpoint(),
            &json!({
                "v": 1,
                "type": "hello",
                "client_pub": URL_SAFE_NO_PAD.encode(public.as_ref()),
            }),
        )
        .await
        .map_err(CallError::Transient)?;
        if !(200..300).contains(&http_status) {
            return Err(classify_outer_http(http_status, &hello, "加密握手失败"));
        }
        let kid = field(&hello, "kid").map_err(CallError::Fatal)?;
        let sid = field(&hello, "sid").map_err(CallError::Fatal)?;
        let site = field(&hello, "site").map_err(CallError::Fatal)?;
        let server_time = hello["server_time"]
            .as_i64()
            .ok_or_else(|| CallError::Fatal("加密握手时间无效".into()))?;
        let ttl = hello["expires_at"]
            .as_i64()
            .and_then(|expires| expires.checked_sub(server_time))
            .filter(|ttl| (6..=600).contains(ttl))
            .ok_or_else(|| CallError::Fatal("加密会话有效期无效".into()))?;
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
            return Err(CallError::Fatal("加密握手响应无效".into()));
        }
        let salt = URL_SAFE_NO_PAD
            .decode(field(&hello, "salt").map_err(CallError::Fatal)?)
            .map_err(|_| CallError::Fatal("加密握手编码无效".into()))?;
        if salt.len() != 32 {
            return Err(CallError::Fatal("加密握手盐值无效".into()));
        }
        let remote = URL_SAFE_NO_PAD
            .decode(field(&hello, "server_pub").map_err(CallError::Fatal)?)
            .map_err(|_| CallError::Fatal("加密公钥编码无效".into()))?;
        let peer = agreement::UnparsedPublicKey::new(&agreement::ECDH_P256, remote);
        let info = format!(
            "dx150-edge-v1\n{}\n{site}\n{kid}\n{sid}",
            scope.as_str()
        );
        let (request_key, response_key) = agreement::agree_ephemeral(secret, &peer, |shared| {
            let prk = hkdf::Salt::new(hkdf::HKDF_SHA256, &salt).extract(shared);
            Ok::<_, String>((
                derive(&prk, &format!("{info}\nreq"))?,
                derive(&prk, &format!("{info}\nres"))?,
            ))
        })
        .map_err(|_| CallError::Fatal("加密密钥协商失败".into()))?
        .map_err(CallError::Fatal)?;
        let clock_offset = server_time
            .checked_sub(now())
            .ok_or_else(|| CallError::Fatal("加密握手时间无效".into()))?;
        Ok(Self {
            scope,
            kid: kid.into(),
            sid: sid.into(),
            info,
            request_key,
            response_key,
            sequence: AtomicU32::new(0),
            clock_offset,
            expires: Instant::now() + Duration::from_secs((ttl - 5) as u64),
        })
    }

    fn is_usable(&self) -> bool {
        self.expires > Instant::now() && self.sequence.load(Ordering::Relaxed) < MAX_SEQUENCE
    }

    fn next_sequence(&self) -> Option<u32> {
        let mut cur = self.sequence.load(Ordering::Relaxed);
        loop {
            if cur >= MAX_SEQUENCE || self.expires <= Instant::now() {
                return None;
            }
            let next = cur + 1;
            match self.sequence.compare_exchange_weak(
                cur,
                next,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => return Some(next),
                Err(actual) => cur = actual,
            }
        }
    }

    async fn call(
        &self,
        origin: &str,
        method: &str,
        path: &str,
        encoded_body: &str,
        content_type: &str,
        token: Option<&str>,
    ) -> Result<DecryptedEnvelope, CallError> {
        let sequence = self
            .next_sequence()
            .ok_or_else(|| CallError::SessionExpired("加密会话已到期".into()))?;
        let timestamp = now()
            .checked_add(self.clock_offset)
            .ok_or_else(|| CallError::Fatal("加密会话时间无效".into()))?;
        let mut packet = json!({
            "request": {
                "method": method,
                "path": path,
                "body": encoded_body,
                "content_type": content_type,
            }
        });
        if self.scope != EdgeScope::Public {
            if let Some(t) = token.filter(|s| !s.is_empty()) {
                packet["authorization"] = json!(format!("Bearer {t}"));
            }
        }
        let mut ciphertext =
            serde_json::to_vec(&packet).map_err(|_| CallError::Fatal("加密请求编码失败".into()))?;
        self.request_key
            .seal_in_place_append_tag(
                nonce_for(sequence),
                aead::Aad::from(aad_for(&self.info, "req", sequence, timestamp)),
                &mut ciphertext,
            )
            .map_err(|_| CallError::Fatal("加密请求封装失败".into()))?;
        let (http_status, result) = crate::net::scope_packet(
            origin,
            self.scope.endpoint(),
            &json!({
                "v": 1,
                "type": "call",
                "kid": self.kid,
                "sid": self.sid,
                "seq": sequence,
                "ts": timestamp,
                "ciphertext": URL_SAFE_NO_PAD.encode(ciphertext),
            }),
        )
        .await
        .map_err(CallError::Transient)?;
        if !(200..300).contains(&http_status) {
            return Err(classify_outer_http(http_status, &result, "加密接口请求失败"));
        }
        self.decode_envelope(&result, sequence, timestamp)
            .map_err(CallError::Fatal)
    }

    pub(crate) fn decode_envelope(
        &self,
        result: &Value,
        sequence: u32,
        timestamp: i64,
    ) -> Result<DecryptedEnvelope, String> {
        if result["v"] != 1
            || result["type"] != "result"
            || result["kid"] != self.kid
            || result["sid"] != self.sid
            || result["seq"] != sequence
            || result["ts"] != timestamp
        {
            return Err("加密接口响应不匹配".into());
        }
        let mut bytes = URL_SAFE_NO_PAD
            .decode(field(result, "ciphertext")?)
            .map_err(|_| "加密响应编码无效")?;
        let plain = self
            .response_key
            .open_in_place(
                nonce_for(sequence),
                aead::Aad::from(aad_for(&self.info, "res", sequence, timestamp)),
                &mut bytes,
            )
            .map_err(|_| "加密响应校验失败")?;
        let inner: Value = serde_json::from_slice(plain).map_err(|_| "加密响应格式无效")?;
        let status = inner["status"]
            .as_u64()
            .and_then(|v| u16::try_from(v).ok())
            .filter(|v| (200..=599).contains(v))
            .ok_or("加密响应状态码无效")?;
        let body = match inner.get("body").and_then(Value::as_str) {
            Some(b) if !b.is_empty() => STANDARD.decode(b).map_err(|_| "加密响应数据编码无效")?,
            _ => Vec::new(),
        };
        Ok(DecryptedEnvelope { status, body })
    }
}

fn classify_outer_http(status: u16, body: &Value, prefix: &str) -> CallError {
    if body.get("error").and_then(Value::as_str) == Some("session_expired") {
        return CallError::SessionExpired("加密会话已过期，正在重试".into());
    }
    let msg = format!("{prefix} (HTTP {status})");
    if matches!(status, 408 | 429 | 500 | 502 | 503 | 504) {
        CallError::Transient(msg)
    } else {
        CallError::Fatal(msg)
    }
}

fn invalidate_session(key: &SessionKey, sid: &str) {
    if let Ok(mut map) = SESSIONS.lock() {
        if map.get(key).is_some_and(|s| s.sid == sid) {
            map.remove(key);
        }
    }
}

async fn get_or_open(origin: &str, scope: EdgeScope) -> Result<Arc<Session>, CallError> {
    let key = (origin.to_string(), scope);
    {
        let map = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(sess) = map.get(&key).filter(|s| s.is_usable()) {
            return Ok(sess.clone());
        }
    }
    let lock = open_lock(&key);
    let _guard = lock.lock().await;
    {
        let map = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(sess) = map.get(&key).filter(|s| s.is_usable()) {
            return Ok(sess.clone());
        }
    }
    let opened = Arc::new(Session::open(origin, scope).await?);
    let mut map = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
    map.retain(|_, s| s.is_usable());
    if map.len() >= MAX_CACHED_SESSIONS {
        map.clear();
    }
    map.insert(key, opened.clone());
    Ok(opened)
}

/// 通过 `dx150-edge-v1` 加密信道向指定作用域发起一次业务请求。
pub(crate) async fn request(
    origin: &str,
    scope: EdgeScope,
    method: &str,
    path: &str,
    encoded_body: &str,
    content_type: &str,
    token: Option<&str>,
) -> Result<DecryptedEnvelope, CallError> {
    let key = (origin.to_string(), scope);
    let mut session = get_or_open(origin, scope).await?;
    match session
        .call(origin, method, path, encoded_body, content_type, token)
        .await
    {
        Ok(env) => Ok(env),
        Err(CallError::SessionExpired(_)) => {
            invalidate_session(&key, &session.sid);
            session = get_or_open(origin, scope).await?;
            let res = session
                .call(origin, method, path, encoded_body, content_type, token)
                .await;
            if res.is_err() {
                invalidate_session(&key, &session.sid);
            }
            res
        }
        Err(err) => {
            invalidate_session(&key, &session.sid);
            Err(err)
        }
    }
}

/// 将业务请求映射到上游当前对应的加密信道作用域。
pub fn scope_for(method: &str, path_with_query: &str) -> EdgeScope {
    let (pathname, query) = path_with_query
        .split_once('?')
        .unwrap_or((path_with_query, ""));
    let segs: Vec<&str> = pathname.split('/').filter(|s| !s.is_empty()).collect();
    let is_read = method.eq_ignore_ascii_case("GET") || method.eq_ignore_ascii_case("HEAD");
    let is_digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());

    // 1. Playback
    if matches!(
        segs.as_slice(),
        ["api", "videos", id, "episodes", ep, "playback"] if is_digits(id) && is_digits(ep)
    ) || matches!(segs.as_slice(), ["api", "videos", id, "playback"] if is_digits(id))
        || (is_read && matches!(segs.as_slice(), ["api", "videos", id, "play"] if is_digits(id)))
        || matches!(segs.as_slice(), ["api", "posts", id, "playback"] if is_digits(id))
        || matches!(segs.as_slice(), ["api", "media", "playback", "previews"])
        || matches!(segs.as_slice(), ["api", "media", "prerolls", id, "playback"] if is_digits(id))
    {
        return EdgeScope::Playback;
    }

    // 2. User (账号、个人数据、互动、评分)
    if pathname.starts_with("/api/account/")
        || pathname == "/api/users/me"
        || pathname.starts_with("/api/users/me/")
        || matches!(
            segs.as_slice(),
            ["api", "ai-wish"] | ["api", "videos", "following"]
        )
        || matches!(
            segs.as_slice(),
            ["api", "videos", id, "rating" | "like" | "collect" | "feedback" | "report" | "interaction-state" | "guest-like" | "guest-liked" | "guest-comments"] if is_digits(id)
        )
        || (!is_read && matches!(segs.as_slice(), ["api", "videos", id, "comments"] if is_digits(id)))
        || matches!(
            segs.as_slice(),
            ["api", "videos", id, "comments", "liked" | "state"] if is_digits(id)
        )
        || matches!(
            segs.as_slice(),
            ["api", "videos", id, "comments", cid, "like" | "guest-like"] if is_digits(id) && is_digits(cid)
        )
        || matches!(
            segs.as_slice(),
            ["api", "posts", id, "like" | "collect" | "visit" | "guest-like" | "guest-liked" | "guest-comments"] if is_digits(id)
        )
        || (!is_read && matches!(segs.as_slice(), ["api", "posts", id, "comments"] if is_digits(id)))
        || matches!(
            segs.as_slice(),
            ["api", "posts", id, "comments", "liked"] if is_digits(id)
        )
        || matches!(
            segs.as_slice(),
            ["api", "posts", id, "comments", cid, "like" | "guest-like"] if is_digits(id) && is_digits(cid)
        )
        || matches!(segs.as_slice(), ["api", "users", id, "follow"] if is_digits(id))
    {
        return EdgeScope::User;
    }

    // 3. Public (仅限只读公开接口；随机排序按上游规则切到 Dynamic)
    if is_read {
        let is_random_sort = url::form_urlencoded::parse(query.as_bytes()).any(|(k, v)| {
            k == "sort" && matches!(v.trim().to_ascii_lowercase().as_str(), "random" | "rand")
        });
        let is_public = match segs.as_slice() {
            ["api", "videos"] | ["api", "videos", "category", _] => !is_random_sort,
            ["api", "videos", "long" | "report-reasons"]
            | ["api", "videos", "sort" | "tag", _]
            | ["api", "tags"]
            | ["api", "topics"]
            | ["api", "topics", _]
            | ["api", "ranks", _]
            | ["api", "posts"]
            | ["api", "posts", "category" | "tag", _]
            | ["api", "search", "hot" | "suggest"]
            | ["api", "search", "tags", "hot"]
            | ["api", "feed", "today" | "recommend"]
            | ["api", "feed", "post", "today"]
            | ["api", "home", "latest" | "recommends"]
            | ["api", "site", "config" | "links" | "menus" | "meta" | "pages" | "transit" | "watermark"]
            | ["api", "site", "pages", _]
            | ["api", "site", "categories", "video" | "post"]
            | ["api", "site", "sorts", "video"] => true,
            ["api", "videos", id, "related"] if is_digits(id) => true,
            ["api", "videos", "user", id] if is_digits(id) => true,
            ["api", "posts", "user", id] if is_digits(id) => true,
            ["api", "posts", id, "adjacent" | "related"] if is_digits(id) => true,
            ["api", "users", id, "stats"] if is_digits(id) => true,
            _ => false,
        };
        if is_public {
            return EdgeScope::Public;
        }
    }

    // 4. Dynamic (详情、搜索、评论读、统计等)
    EdgeScope::Dynamic
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn fixture_session(scope: EdgeScope) -> Session {
        let key =
            || aead::LessSafeKey::new(aead::UnboundKey::new(&aead::AES_256_GCM, &[9; 32]).unwrap());
        Session {
            scope,
            kid: "test".into(),
            sid: "test-session-123456".into(),
            info: "fixture".into(),
            request_key: key(),
            response_key: key(),
            sequence: AtomicU32::new(1),
            clock_offset: 0,
            expires: Instant::now() + Duration::from_secs(60),
        }
    }

    pub(crate) fn seal_response(session: &Session, status: u16, body: &Value) -> Value {
        let mut bytes = serde_json::to_vec(&json!({
            "status": status,
            "headers": {},
            "body": STANDARD.encode(serde_json::to_vec(body).unwrap())
        }))
        .unwrap();
        session
            .response_key
            .seal_in_place_append_tag(
                nonce_for(1),
                aead::Aad::from(aad_for(&session.info, "res", 1, 123)),
                &mut bytes,
            )
            .unwrap();
        json!({
            "v": 1,
            "type": "result",
            "kid": session.kid,
            "sid": session.sid,
            "seq": 1,
            "ts": 123,
            "ciphertext": URL_SAFE_NO_PAD.encode(bytes)
        })
    }

    #[test]
    fn routes_map_to_expected_scopes() {
        assert_eq!(scope_for("GET", "/api/videos?page=1&size=10"), EdgeScope::Public);
        assert_eq!(
            scope_for("GET", "/api/videos?page=1&sort=random"),
            EdgeScope::Dynamic
        );
        assert_eq!(
            scope_for("GET", "/api/videos/category/ai-duanju?page=1"),
            EdgeScope::Public
        );
        assert_eq!(
            scope_for("GET", "/api/site/categories/video"),
            EdgeScope::Public
        );
        assert_eq!(scope_for("GET", "/api/ranks/hot"), EdgeScope::Public);
        assert_eq!(scope_for("GET", "/api/topics?page=1"), EdgeScope::Public);
        assert_eq!(scope_for("GET", "/api/posts?page=1"), EdgeScope::Public);
        assert_eq!(scope_for("GET", "/api/search?q=ai"), EdgeScope::Dynamic);
        assert_eq!(scope_for("GET", "/api/videos/117"), EdgeScope::Dynamic);
        assert_eq!(scope_for("GET", "/api/posts/12"), EdgeScope::Dynamic);
        assert_eq!(
            scope_for("GET", "/api/videos/117/comments?ep=1"),
            EdgeScope::Dynamic
        );
        assert_eq!(
            scope_for("POST", "/api/videos/117/comments?ep=1"),
            EdgeScope::User
        );
        assert_eq!(scope_for("GET", "/api/videos/117/rating"), EdgeScope::User);
        assert_eq!(
            scope_for("POST", "/api/account/loginByPassword"),
            EdgeScope::User
        );
        assert_eq!(
            scope_for("POST", "/api/videos/117/like?ep=1"),
            EdgeScope::User
        );
        assert_eq!(
            scope_for("POST", "/api/videos/117/episodes/3/playback"),
            EdgeScope::Playback
        );
    }

    #[test]
    fn authenticated_response_and_packet_binding() {
        let session = fixture_session(EdgeScope::Playback);
        let packet = seal_response(
            &session,
            200,
            &json!({"status": 1, "data": {"streams": {"main": "https://cdn.example/test.m3u8"}}}),
        );
        let env = session.decode_envelope(&packet, 1, 123).unwrap();
        assert_eq!(env.status, 200);
        let body: Value = serde_json::from_slice(&env.body).unwrap();
        assert_eq!(body["data"]["streams"]["main"], "https://cdn.example/test.m3u8");
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
            assert!(
                session.decode_envelope(&changed, 1, 123).is_err(),
                "must bind {field}"
            );
        }
        let mut changed = packet;
        let mut bytes = URL_SAFE_NO_PAD
            .decode(changed["ciphertext"].as_str().unwrap())
            .unwrap();
        bytes[0] ^= 1;
        changed["ciphertext"] = json!(URL_SAFE_NO_PAD.encode(bytes));
        assert!(session.decode_envelope(&changed, 1, 123).is_err());
    }
}

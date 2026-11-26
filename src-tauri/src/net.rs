//! 网络层：与上游站点对话。
//!
//! 站点自 2026-11-25 起停用旧 `/api/edge/request`，改由四个作用域入口承担：
//! `/api/public/request`（支持 `X-HG-Public-JSON: 1` 与 `dx150-edge-v1`）、
//! `/api/dynamic/request`、`/api/playback/request`、`/api/user/request`。
//!
//! # 代理（用户反馈「浏览器能开、HGhub 打不开」的根因就在这里）
//!
//! 客户端的流量**全部**走本文件的 reqwest，跟 WebView2 无关，所以它既不共享
//! 浏览器的代理设置，也不共享浏览器的证书库：
//!
//! * reqwest 只有开了 `system-proxy` feature 才会读 Windows 系统代理
//!   （`HKCU\...\Internet Settings` 的 `ProxyEnable`/`ProxyServer`/`ProxyOverride`）。
//! * 当代理生效时，实际 DNS 解析在代理侧完成；若仍强行在本地做 DNS 校验，
//!   国内直连 DNS 投毒（如 `127.0.0.1` / `0.0.0.0` / 超时）会误拦可用代理请求。
//! * 即使开了 `system-proxy`，PAC（`AutoConfigURL`）也不被 reqwest 原生支持。
//! * Android 没有注册表可读，系统「Wi-Fi 代理」同样不被 reqwest 采用；
//!   安卓上只有 VPN/TUN 模式（VpnService 抓全流量）才有效。
//!
//! 排查手段：环境变量 `HGHUB_PROXY=http://127.0.0.1:7897` 可强制指定代理，
//! `net_diag` 命令会输出 DNS / 系统代理 / API / 环境变量快照。

use crate::edge_crypto::{self, CallError, EdgeScope};
use crate::network_policy;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

/// 默认上游（固定线路 1）。
pub const DEFAULT_BASE: &str = "https://huangguoai.com";
/// 备用固定线路（固定线路 2）。
pub const FALLBACK_FIXED_BASE: &str = "https://huangguodrama.io";

/// 当前上游基址（不带结尾斜杠）。可在设置里切到固定线路 2 或镜像线路，运行时立即生效。
static BASE: Lazy<RwLock<String>> = Lazy::new(|| RwLock::new(DEFAULT_BASE.to_string()));
/// 线路配置落盘位置（应用数据目录/line.json），由 [`bind_base`] 在启动时绑定。
static BASE_FILE: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

/// 当前上游基址。
pub fn base() -> String {
    BASE.read()
        .map(|b| b.clone())
        .unwrap_or_else(|_| DEFAULT_BASE.to_string())
}

/// 线路必须是纯 HTTPS origin，不允许路径、认证、查询串或片段。
pub fn normalize_base(raw: &str) -> Option<String> {
    let parsed = network_policy::parse_target(raw.trim()).ok()?;
    if parsed.scheme() != "https"
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return None;
    }
    Some(parsed.origin().ascii_serialization())
}

/// 远端发布页只提供游客镜像，不能扩展账号密码的信任范围。
pub fn trusted_auth_origin(origin: &str) -> bool {
    matches!(origin, "https://huangguoai.com" | "https://huangguodrama.io")
}

/// 启动时读回上次选择的线路（文件不存在 / 内容坏了就保持默认；旧中转页 `huangguoai.ai` 自动迁移）。
pub fn bind_base(dir: &std::path::Path) {
    network_policy::bind_security(dir);
    let path = dir.join("line.json");
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            if let Some(mut next) = v
                .get("base")
                .and_then(|x| x.as_str())
                .and_then(normalize_base)
            {
                let migrated = next == "https://huangguoai.ai";
                if migrated {
                    next = FALLBACK_FIXED_BASE.to_string();
                }
                if let Ok(mut cur) = BASE.write() {
                    *cur = next.clone();
                }
                if migrated {
                    let _ = std::fs::write(&path, json!({ "base": next }).to_string());
                }
            }
        }
    }
    if let Ok(mut f) = BASE_FILE.write() {
        *f = Some(path);
    }
}

/// 切换线路并落盘，返回规整后的地址。
pub fn set_base(url: &str) -> Result<String, String> {
    let next = normalize_base(url)
        .ok_or_else(|| "线路地址无效（需要纯 HTTPS 站点地址，禁止内网）".to_string())?;
    if let Ok(mut cur) = BASE.write() {
        *cur = next.clone();
    }
    if let Some(path) = BASE_FILE.read().ok().and_then(|p| p.clone()) {
        let _ = std::fs::write(path, json!({ "base": next }).to_string());
    }
    Ok(next)
}

pub const UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/// 手动指定代理（排查 / 公司内网用）：`HGHUB_PROXY=http://127.0.0.1:7897`。
/// 不设时交给 reqwest 的 `system-proxy` 探测（注册表 + 环境变量）。
fn proxy_override() -> Option<String> {
    std::env::var("HGHUB_PROXY")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn env_nonempty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[derive(Clone, Debug, Default)]
struct WindowsProxyConfig {
    enabled: bool,
    server: String,
    overrides: String,
    pac_url: String,
}

#[cfg(target_os = "windows")]
fn read_windows_proxy() -> Option<WindowsProxyConfig> {
    use std::ffi::c_void;
    const HKEY_CURRENT_USER: *mut c_void = (-2147483647i32) as isize as *mut c_void;
    const KEY_READ: u32 = 0x20019;
    const REG_DWORD: u32 = 4;
    const REG_SZ: u32 = 1;
    const REG_EXPAND_SZ: u32 = 2;

    #[link(name = "advapi32")]
    extern "system" {
        fn RegOpenKeyExW(
            hkey: *mut c_void,
            subkey: *const u16,
            options: u32,
            sam: u32,
            result: *mut *mut c_void,
        ) -> i32;
        fn RegQueryValueExW(
            hkey: *mut c_void,
            name: *const u16,
            reserved: *mut u32,
            val_type: *mut u32,
            data: *mut u8,
            len: *mut u32,
        ) -> i32;
        fn RegCloseKey(hkey: *mut c_void) -> i32;
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    unsafe fn query_dword(hkey: *mut c_void, name: &str) -> Option<u32> {
        let wname = wide(name);
        let mut kind = 0u32;
        let mut val = 0u32;
        let mut len = 4u32;
        let rc = RegQueryValueExW(
            hkey,
            wname.as_ptr(),
            std::ptr::null_mut(),
            &mut kind,
            (&mut val as *mut u32).cast(),
            &mut len,
        );
        (rc == 0 && kind == REG_DWORD && len == 4).then_some(val)
    }

    unsafe fn query_string(hkey: *mut c_void, name: &str) -> Option<String> {
        let wname = wide(name);
        let mut kind = 0u32;
        let mut len = 0u32;
        let rc = RegQueryValueExW(
            hkey,
            wname.as_ptr(),
            std::ptr::null_mut(),
            &mut kind,
            std::ptr::null_mut(),
            &mut len,
        );
        if rc != 0 || len == 0 || (kind != REG_SZ && kind != REG_EXPAND_SZ) {
            return None;
        }
        let mut buf = vec![0u8; len as usize];
        let rc2 = RegQueryValueExW(
            hkey,
            wname.as_ptr(),
            std::ptr::null_mut(),
            &mut kind,
            buf.as_mut_ptr(),
            &mut len,
        );
        if rc2 != 0 {
            return None;
        }
        let units: Vec<u16> = buf[..len as usize]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .take_while(|&u| u != 0)
            .collect();
        let text = String::from_utf16_lossy(&units).trim().to_string();
        (!text.is_empty()).then_some(text)
    }

    let subkey = wide("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings");
    let mut hkey: *mut c_void = std::ptr::null_mut();
    unsafe {
        if RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_READ, &mut hkey) != 0 {
            return None;
        }
        let cfg = WindowsProxyConfig {
            enabled: query_dword(hkey, "ProxyEnable").unwrap_or(0) != 0,
            server: query_string(hkey, "ProxyServer").unwrap_or_default(),
            overrides: query_string(hkey, "ProxyOverride").unwrap_or_default(),
            pac_url: query_string(hkey, "AutoConfigURL").unwrap_or_default(),
        };
        RegCloseKey(hkey);
        Some(cfg)
    }
}

#[cfg(not(target_os = "windows"))]
fn read_windows_proxy() -> Option<WindowsProxyConfig> {
    None
}

fn host_matches_bypass(host: &str, patterns: &str, sep: char, support_local_kw: bool) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    for raw in patterns.split(sep) {
        let pat = raw.trim().to_ascii_lowercase();
        if pat.is_empty() {
            continue;
        }
        if pat == "*" {
            return true;
        }
        if support_local_kw && pat == "<local>" && !host.contains('.') {
            return true;
        }
        if let Some(prefix) = pat.strip_suffix('*') {
            if host.starts_with(prefix) {
                return true;
            }
        } else if let Some(suffix) = pat.strip_prefix("*.") {
            if host == suffix || host.ends_with(&format!(".{suffix}")) {
                return true;
            }
        } else if let Some(suffix) = pat.strip_prefix('.') {
            if host == suffix || host.ends_with(&format!(".{suffix}")) {
                return true;
            }
        } else if host == pat || host.ends_with(&format!(".{pat}")) {
            return true;
        }
    }
    false
}

fn env_proxy_applies(scheme: &str, host: &str) -> bool {
    let has_env = match scheme {
        "https" => env_nonempty("HTTPS_PROXY")
            .or_else(|| env_nonempty("https_proxy"))
            .or_else(|| env_nonempty("ALL_PROXY"))
            .or_else(|| env_nonempty("all_proxy"))
            .is_some(),
        "http" => env_nonempty("HTTP_PROXY")
            .or_else(|| env_nonempty("http_proxy"))
            .or_else(|| env_nonempty("ALL_PROXY"))
            .or_else(|| env_nonempty("all_proxy"))
            .is_some(),
        _ => false,
    };
    if !has_env {
        return false;
    }
    let no_proxy = env_nonempty("NO_PROXY").or_else(|| env_nonempty("no_proxy"));
    !no_proxy.is_some_and(|list| host_matches_bypass(host, &list, ',', false))
}

fn windows_proxy_applies(host: &str, cfg: &WindowsProxyConfig) -> bool {
    cfg.enabled
        && !cfg.server.trim().is_empty()
        && !host_matches_bypass(host, &cfg.overrides, ';', true)
}

fn proxy_applies_to_url(url: &UrlProxyTarget<'_>) -> bool {
    if proxy_override().is_some() {
        return true;
    }
    if env_proxy_applies(url.scheme, url.host) {
        return true;
    }
    read_windows_proxy().is_some_and(|cfg| windows_proxy_applies(url.host, &cfg))
}

struct UrlProxyTarget<'a> {
    scheme: &'a str,
    host: &'a str,
}

fn proxy_signature() -> String {
    let hghub = proxy_override().unwrap_or_default();
    let http = env_nonempty("HTTP_PROXY")
        .or_else(|| env_nonempty("http_proxy"))
        .unwrap_or_default();
    let https = env_nonempty("HTTPS_PROXY")
        .or_else(|| env_nonempty("https_proxy"))
        .unwrap_or_default();
    let all = env_nonempty("ALL_PROXY")
        .or_else(|| env_nonempty("all_proxy"))
        .unwrap_or_default();
    let no_proxy = env_nonempty("NO_PROXY")
        .or_else(|| env_nonempty("no_proxy"))
        .unwrap_or_default();
    let win = read_windows_proxy()
        .map(|c| format!("{}:{}:{}", c.enabled as u8, c.server, c.overrides))
        .unwrap_or_default();
    format!("{hghub}|{http}|{https}|{all}|{no_proxy}|{win}")
}

/// 按**当前**系统代理设置新建一个客户端。
///
/// 注意：reqwest 的 `system-proxy` 只在构建时读一次注册表 / 环境变量。代理软件被关掉后，
/// 旧客户端仍会往 `127.0.0.1:7897` 建隧道，症状是满屏 `tunnel error: failed to create
/// underlying connection`（浏览器却是通的，因为它每次都重读系统代理）。所以这里允许重建。
fn build_client(host: &str, addrs: &[SocketAddr]) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(45))
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .referer(false)
        .gzip(true)
        .brotli(true)
        .pool_idle_timeout(Duration::from_secs(60));
    if !addrs.is_empty() {
        builder = builder.resolve_to_addrs(host, addrs);
    }
    if let Some(p) = proxy_override() {
        // 错误信息不能含原始代理 URL（其中可能有用户名/密码）。
        let proxy = reqwest::Proxy::all(&p).map_err(|_| "HGHUB_PROXY 配置无效（已隐藏原始值）")?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|_| "无法创建 HTTP 客户端".to_string())
}

const CLIENT_TTL: Duration = Duration::from_secs(30);
type ClientCache = HashMap<String, (Instant, Arc<reqwest::Client>)>;
static CLIENTS: Lazy<Mutex<ClientCache>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn cached_client(cache: &ClientCache, key: &str, now: Instant) -> Option<Arc<reqwest::Client>> {
    cache
        .get(key)
        .filter(|(expires, _)| now < *expires)
        .map(|(_, http)| http.clone())
}

/// 缓存按模式、主机、端口与当前代理指纹隔离；有效期内仅复用已检查的客户端。
/// 代理变化会立即使缓存失效；直连模式下到期后重新检查全部 DNS 答案。
async fn client_for(raw: &str) -> Result<(url::Url, Arc<reqwest::Client>), String> {
    let strict = network_policy::strict_security();
    let target = network_policy::parse_target_with_mode(raw, strict)?;
    let host = target.host_str().ok_or("目标缺少主机名")?;
    let port = target.port_or_known_default().ok_or("目标端口无效")?;
    let sig = proxy_signature();
    let key = format!("{strict}:{host}:{port}:{sig}");
    {
        let cache = CLIENTS.lock().map_err(|_| "HTTP 客户端锁失败")?;
        if let Some(http) = cached_client(&cache, &key, Instant::now()) {
            return Ok((target, http));
        }
    }
    let proxied = proxy_applies_to_url(&UrlProxyTarget {
        scheme: target.scheme(),
        host,
    });
    let addrs = if strict && !proxied {
        network_policy::resolve_target(&target, strict).await?
    } else {
        Vec::new()
    };
    let http = Arc::new(build_client(host, &addrs)?);
    let now = Instant::now();
    let mut cache = CLIENTS.lock().map_err(|_| "HTTP 客户端锁失败")?;
    // 同时到达的请求可能已完成解析；不延长已有结果的有效期。
    let http = cached_client(&cache, &key, now).unwrap_or(http);
    if !cache.get(&key).is_some_and(|(expires, _)| now < *expires) {
        cache.retain(|_, (expires, _)| now < *expires);
        if cache.len() >= 64 {
            cache.clear();
        }
        cache.insert(key, (now + CLIENT_TTL, http.clone()));
    }
    Ok((target, http))
}

pub fn refresh_client() {
    if let Ok(mut cache) = CLIENTS.lock() {
        cache.clear();
    }
}

/// 不可信 GET 的统一入口；自动重定向被关闭，每一跳重新检查 URL、DNS 并固定解析地址。
pub async fn get(
    raw: &str,
    timeout: Duration,
    accept: Option<&str>,
    referer: Option<&str>,
) -> Result<reqwest::Response, String> {
    tokio::time::timeout(timeout, async {
        let mut next = network_policy::parse_target(raw)?;
        for hop in 0..=5 {
            let (target, http) = client_for(next.as_str()).await?;
            let mut request = http.get(target.clone()).timeout(timeout);
            if let Some(value) = accept {
                request = request.header("Accept", value);
            }
            if let Some(value) = referer {
                request = request.header("Referer", value);
            }
            let response = request.send().await.map_err(|e| err_text(&e))?;
            if !matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
                return Ok(response);
            }
            if hop == 5 {
                return Err("重定向次数超过限制".into());
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|h| h.to_str().ok())
                .ok_or("重定向缺少有效 Location")?;
            next = network_policy::redirect_target(&target, location)?;
        }
        Err("重定向次数超过限制".into())
    })
    .await
    .map_err(|_| "请求超时".to_string())?
}

/// 只返回代理的协议/主机/端口；解析失败时隐藏整个值，绝不回传认证或查询参数。
pub fn redact_proxy(raw: &str) -> String {
    let parsed = url::Url::parse(raw.trim())
        .ok()
        .filter(|u| u.host_str().is_some());
    match parsed {
        Some(url) => {
            let mut safe = format!("{}://{}", url.scheme(), url.host_str().unwrap());
            if let Some(port) = url.port() {
                safe.push_str(&format!(":{port}"));
            }
            safe
        }
        None => "[已配置，原始值已隐藏]".into(),
    }
}

fn redact_windows_proxy_server(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.contains("://") {
        return redact_proxy(trimmed);
    }
    if !trimmed.is_empty()
        && !trimmed.contains('@')
        && !trimmed.contains(' ')
        && !trimmed.contains('=')
        && !trimmed.contains(';')
    {
        return redact_proxy(&format!("http://{trimmed}"));
    }
    "[已配置，原始值已隐藏]".into()
}

/// 看起来像代理 / 隧道问题（而不是目标站点本身不可达）。
pub fn is_proxy_error(e: &str) -> bool {
    let e = e.to_ascii_lowercase();
    e.contains("tunnel") || e.contains("proxy")
}

static LAST_HEAL: Lazy<std::sync::Mutex<Option<Instant>>> =
    Lazy::new(|| std::sync::Mutex::new(None));

/// 请求失败后按需重建客户端：代理隧道错误、连接被拒 / 重置 / 超时都算「网络环境可能变了」。
/// 3 秒内只重建一次，批量探测不会反复重建。
pub fn heal_client(reason: &str) {
    let lower = reason.to_ascii_lowercase();
    let connectish = lower.contains("connect")
        || lower.contains("timed out")
        || reason.contains("超时")
        || lower.contains("refused")
        || lower.contains("reset")
        || lower.contains("broken pipe")
        || lower.contains("eof")
        || lower.contains("dns")
        || lower.contains("handshake")
        || lower.contains("tls");
    if !is_proxy_error(reason) && !connectish {
        return;
    }
    let mut last = match LAST_HEAL.lock() {
        Ok(l) => l,
        Err(_) => return,
    };
    if let Some(t) = *last {
        if t.elapsed() < Duration::from_secs(3) {
            return;
        }
    }
    *last = Some(Instant::now());
    drop(last);
    refresh_client();
}

/// reqwest 的 `Display` 只有「error sending request for url (...)」，
/// 真正的原因（dns error / connection refused / invalid peer certificate）
/// 藏在 `source()` 链里。展开成一行，界面和 debug.log 才有排查价值。
pub fn err_text(e: &reqwest::Error) -> String {
    let mut out = e.to_string();
    let mut src = std::error::Error::source(e);
    while let Some(s) = src {
        let t = s.to_string();
        if !t.is_empty() && !out.contains(&t) {
            out.push_str(" ← ");
            out.push_str(&t);
        }
        src = s.source();
    }
    out
}

fn dns_summary(addrs: impl IntoIterator<Item = SocketAddr>) -> Value {
    let mut ips: Vec<_> = addrs.into_iter().map(|addr| addr.ip()).collect();
    ips.sort_unstable();
    ips.dedup();
    let has_fake_ip = ips.iter().any(|ip| {
        let v4 = match ip {
            std::net::IpAddr::V4(v4) => Some(*v4),
            std::net::IpAddr::V6(v6) => v6.to_ipv4_mapped(),
        };
        v4.is_some_and(|ip| {
            let [a, b, _, _] = ip.octets();
            a == 198 && (b == 18 || b == 19)
        })
    });
    json!({ "count": ips.len(), "has_fake_ip": has_fake_ip })
}

fn dns_diag_flags(addrs: &[SocketAddr]) -> Value {
    let has_teredo_poison = addrs.iter().any(|a| network_policy::is_teredo(a.ip()));
    let has_private_ip = addrs.iter().any(|a| {
        !network_policy::is_teredo(a.ip()) && !network_policy::allowed_ip(a.ip())
    });
    json!({
        "has_teredo_poison": has_teredo_poison,
        "has_private_ip": has_private_ip,
    })
}

/// 网络自检：DNS / 系统代理 / HTTP / API / 环境变量快照，用于远程定位「打不开」。
pub async fn diagnose() -> Value {
    let cur = base();
    let host = url::Url::parse(&cur)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
        .unwrap_or_default();

    // fake-ip（198.18.0.0/15）说明 DNS 被 TUN 接管：关掉 TUN 后这个地址根本不可路由。
    let resolved = {
        let host = host.clone();
        tokio::task::spawn_blocking(move || {
            use std::net::ToSocketAddrs;
            (host.as_str(), 443u16)
                .to_socket_addrs()
                .map(|iter| iter.collect::<Vec<_>>())
        })
        .await
        .ok()
    };
    let (dns, dns_flags) = match resolved {
        Some(Ok(addrs)) => (dns_summary(addrs.iter().copied()), dns_diag_flags(&addrs)),
        Some(Err(_)) => (json!({ "error": "DNS 解析失败" }), Value::Null),
        None => (Value::Null, Value::Null),
    };

    let win_proxy = read_windows_proxy().map(|cfg| {
        json!({
            "enabled": cfg.enabled,
            "server": (!cfg.server.is_empty()).then(|| redact_windows_proxy_server(&cfg.server)),
            "bypass_configured": !cfg.overrides.is_empty(),
            "pac_configured": !cfg.pac_url.is_empty(),
        })
    });
    let proxy_active = proxy_applies_to_url(&UrlProxyTarget {
        scheme: "https",
        host: &host,
    });

    let started = Instant::now();
    let http = match get(&format!("{cur}/"), Duration::from_secs(15), None, None).await {
        Ok(r) => json!({
            "status": r.status().as_u16(),
            "ms": started.elapsed().as_millis() as u64,
        }),
        Err(e) => json!({
            "error": e,
            "ms": started.elapsed().as_millis() as u64,
        }),
    };

    let api_started = Instant::now();
    let api = match edge(&cur, "GET", "/api/site/categories/video", None, None).await {
        Ok(_) => json!({
            "ok": true,
            "ms": api_started.elapsed().as_millis() as u64,
        }),
        Err(e) => json!({
            "ok": false,
            "error": e,
            "ms": api_started.elapsed().as_millis() as u64,
        }),
    };

    json!({
        "base": cur,
        "host": host,
        "strict_security": network_policy::strict_security(),
        "proxy_active": proxy_active,
        "system_proxy": win_proxy,
        "dns": dns,
        "dns_flags": dns_flags,
        "http": http,
        "api": api,
        "env": {
            "HTTP_PROXY": env_nonempty("HTTP_PROXY").map(|p| redact_proxy(&p)),
            "HTTPS_PROXY": env_nonempty("HTTPS_PROXY").map(|p| redact_proxy(&p)),
            "ALL_PROXY": env_nonempty("ALL_PROXY").map(|p| redact_proxy(&p)),
            "NO_PROXY": env_nonempty("NO_PROXY").map(|_| "[已配置，列表已隐藏]"),
            "HGHUB_PROXY": proxy_override().map(|p| redact_proxy(&p)),
        },
    })
}

/// 站点偶发 TLS 抖动（实测），统一重试；碰上代理隧道错误就先重建客户端再试
/// （代理软件开关后旧客户端会一直卡在 tunnel error 上）。
async fn with_retry<F, Fut, T>(retry: bool, mut f: F) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, CallError>>,
{
    let mut last = String::from("network error");
    let attempts = if retry { 3 } else { 1 };
    for attempt in 0..attempts {
        match f().await {
            Ok(v) => return Ok(v),
            Err(err) => {
                let can_retry = err.is_retryable();
                last = err.into_message();
                heal_client(&last);
                if !can_retry || attempt + 1 >= attempts {
                    return Err(last);
                }
                tokio::time::sleep(Duration::from_millis(350 * (attempt as u64 + 1))).await;
            }
        }
    }
    Err(last)
}

/// 仅无请求体、无凭据的逻辑 GET 可以迁移网关；信封本身仍使用 POST。
fn edge_redirect_target(
    current: &url::Url,
    status: u16,
    location: &str,
    guest_get: bool,
) -> Result<url::Url, String> {
    if !guest_get || !matches!(status, 301 | 302 | 303) {
        return Err("业务接口重定向已拒绝".into());
    }
    network_policy::redirect_target(current, location)
}

/// 加密通道（`dx150-edge-v1`）统一传输：绝不跟随重定向，避免会话包或凭据外泄。
pub(crate) async fn scope_packet(
    origin: &str,
    endpoint: &str,
    packet: &Value,
) -> Result<(u16, Value), String> {
    let url = format!("{origin}{endpoint}");
    let (target, http) = client_for(&url).await?;
    let response = http
        .post(target)
        .header("Accept", "application/json")
        .header("Referer", format!("{origin}/"))
        .json(packet)
        .send()
        .await
        .map_err(|e| err_text(&e))?;
    let status = response.status().as_u16();
    let text = response.text().await.map_err(|e| err_text(&e))?;
    if text.trim().is_empty() {
        return Ok((status, Value::Null));
    }
    match serde_json::from_str::<Value>(&text) {
        Ok(v) => Ok((status, v)),
        Err(_) if !(200..300).contains(&status) => {
            Err(format!("通道请求失败 (HTTP {status})，请重试"))
        }
        Err(_) => Err("通道返回无效 JSON".into()),
    }
}

fn sorted_public_path(path: &str) -> String {
    let Some((pathname, query)) = path.split_once('?') else {
        return path.to_string();
    };
    let mut pairs: Vec<(String, String)> = url::form_urlencoded::parse(query.as_bytes())
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    pairs.sort_by(|a, b| a.0.cmp(&b.0));
    let mut ser = url::form_urlencoded::Serializer::new(String::new());
    for (k, v) in pairs {
        ser.append_pair(&k, &v);
    }
    let q = ser.finish();
    if q.is_empty() {
        pathname.to_string()
    } else {
        format!("{pathname}?{q}")
    }
}

enum PublicJsonResult {
    Response(u16, String),
    FallbackToEncrypted,
}

async fn try_public_json(origin: &str, method: &str, path: &str) -> Result<PublicJsonResult, CallError> {
    let sorted = sorted_public_path(path);
    let packet = json!({
        "method": method,
        "path": sorted,
        "body": "",
        "content_type": "",
    });
    let url = format!("{origin}/api/public/request");
    let referer = format!("{origin}/");
    let mut next = network_policy::parse_target(&url).map_err(CallError::Fatal)?;
    for hop in 0..=5 {
        let (target, client) = client_for(next.as_str())
            .await
            .map_err(CallError::Transient)?;
        let resp = client
            .post(target.clone())
            .header("Accept", "application/json")
            .header("Referer", &referer)
            .header("X-HG-Public-JSON", "1")
            .json(&packet)
            .send()
            .await
            .map_err(|e| CallError::Transient(err_text(&e)))?;
        let status = resp.status();
        if status.is_redirection() {
            if hop == 5 {
                return Err(CallError::Fatal("重定向次数超过限制".into()));
            }
            let location = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|h| h.to_str().ok())
                .ok_or_else(|| CallError::Fatal("重定向缺少有效 Location".into()))?;
            next = edge_redirect_target(&target, status.as_u16(), location, true)
                .map_err(CallError::Fatal)?;
            continue;
        }
        let has_marker = resp
            .headers()
            .get("X-HG-Public-JSON")
            .and_then(|v| v.to_str().ok())
            == Some("1");
        let code = status.as_u16();
        let text = resp
            .text()
            .await
            .map_err(|e| CallError::Transient(err_text(&e)))?;
        if code == 400 && !has_marker {
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                if matches!(
                    v.get("error").and_then(Value::as_str),
                    Some("invalid_request" | "unsupported_version")
                ) {
                    return Ok(PublicJsonResult::FallbackToEncrypted);
                }
            }
        }
        return Ok(PublicJsonResult::Response(code, text));
    }
    Err(CallError::Fatal("重定向次数超过限制".into()))
}

fn unwrap_api_response(status: u16, text: &str) -> Result<Value, CallError> {
    if status == 401 || status == 403 {
        return Err(CallError::Fatal("401".to_string()));
    }
    if !(200..300).contains(&status) {
        let preview: String = text.chars().take(160).collect();
        let msg = format!("HTTP {status}: {preview}");
        let retryable = matches!(status, 408 | 429 | 500 | 502 | 503 | 504)
            && !text.contains("接口已停用");
        return Err(if retryable {
            CallError::Transient(msg)
        } else {
            CallError::Fatal(msg)
        });
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    let value = serde_json::from_str::<Value>(text).map_err(|e| {
        let preview: String = text.chars().take(160).collect();
        CallError::Fatal(format!("{e}: {preview}"))
    })?;
    if value.is_null() {
        return Ok(Value::Null);
    }
    if value.get("status").and_then(|v| v.as_i64()) == Some(1) {
        Ok(value.get("data").cloned().unwrap_or(Value::Null))
    } else {
        Err(CallError::Fatal(
            value
                .get("msg")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or("接口返回失败")
                .to_string(),
        ))
    }
}

/// 业务请求：按路由作用域走当前站点加密信道（公开只读优先 `X-HG-Public-JSON`，必要时回退加密信道）。
pub async fn edge(
    origin: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
    token: Option<&str>,
) -> Result<Value, String> {
    let cur = normalize_base(origin).ok_or("业务请求必须使用安全 HTTPS 线路")?;
    let pathname = path.split_once('?').map(|(p, _)| p).unwrap_or(path);
    if network_policy::strict_security()
        && (token.is_some()
            || matches!(
                pathname,
                "/api/account/loginByPassword" | "/api/account/registerByPassword"
            ))
        && !trusted_auth_origin(&cur)
    {
        return Err("镜像线路仅供游客浏览；登录/注册请切换到固定线路".into());
    }
    let (encoded, ctype) = match &body {
        Some(v) => (
            B64.encode(serde_json::to_vec(v).map_err(|e| e.to_string())?),
            "application/json",
        ),
        None => (String::new(), ""),
    };

    let scope = edge_crypto::scope_for(method, path);
    let can_public_json = scope == EdgeScope::Public
        && method.eq_ignore_ascii_case("GET")
        && body.is_none()
        && token.is_none();
    let token = token.map(|s| s.to_string());
    let idempotent = method.eq_ignore_ascii_case("GET") && body.is_none();

    with_retry(idempotent, || {
        let cur = cur.clone();
        let encoded = encoded.clone();
        let token = token.clone();
        async move {
            if can_public_json {
                if let PublicJsonResult::Response(status, text) =
                    try_public_json(&cur, method, path).await?
                {
                    return unwrap_api_response(status, &text);
                }
            }
            let env = edge_crypto::request(
                &cur,
                scope,
                method,
                path,
                &encoded,
                ctype,
                token.as_deref(),
            )
            .await?;
            let text = String::from_utf8(env.body)
                .map_err(|_| CallError::Fatal("接口返回非 UTF-8 数据".into()))?;
            unwrap_api_response(env.status, &text)
        }
    })
    .await
}

/// 拉原始字节（图片 / m3u8 / 分片）。
pub async fn fetch_bytes(url: &str) -> Result<(Option<String>, Vec<u8>), String> {
    let url = url.to_string();
    let referer = format!("{}/", base());
    with_retry(true, || {
        let url = url.clone();
        let referer = referer.clone();
        async move {
            let resp = get(&url, Duration::from_secs(20), None, Some(&referer))
                .await
                .map_err(CallError::Transient)?;
            let status = resp.status();
            if !status.is_success() {
                let code = status.as_u16();
                let msg = format!("HTTP {status}");
                return Err(if matches!(code, 408 | 429 | 500 | 502 | 503 | 504) {
                    CallError::Transient(msg)
                } else {
                    CallError::Fatal(msg)
                });
            }
            let ctype = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
            let bytes = resp
                .bytes()
                .await
                .map_err(|e| CallError::Transient(err_text(&e)))?
                .to_vec();
            Ok((ctype, bytes))
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn non_idempotent_operations_are_attempted_once() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        for (retry, expected) in [(false, 1), (true, 3)] {
            let calls = AtomicUsize::new(0);
            let result = with_retry(retry, || async {
                calls.fetch_add(1, Ordering::SeqCst);
                Err::<(), _>(CallError::Transient("rejected".to_string()))
            })
            .await;
            assert!(result.is_err());
            assert_eq!(calls.load(Ordering::SeqCst), expected);
        }
    }

    #[tokio::test]
    async fn fatal_errors_do_not_retry() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let calls = AtomicUsize::new(0);
        let result = with_retry(true, || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Err::<(), _>(CallError::Fatal("401".to_string()))
        })
        .await;
        assert_eq!(result.unwrap_err(), "401");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn dns_diagnostics_only_expose_counts_and_fake_ip_presence() {
        let addrs: Vec<SocketAddr> = ["10.0.0.1:443", "198.18.0.2:443", "[::ffff:198.18.0.3]:443"]
            .into_iter()
            .map(|raw| raw.parse().unwrap())
            .collect();
        let summary = dns_summary(addrs);
        assert_eq!(summary, json!({"count": 3, "has_fake_ip": true}));
        assert!(!summary.to_string().contains("10.0.0.1"));
        assert!(!summary.to_string().contains("198.18"));
        assert_eq!(
            dns_summary(Vec::<SocketAddr>::new()),
            json!({"count":0,"has_fake_ip":false})
        );
    }

    #[test]
    fn proxy_bypass_rules_match_expected_hosts() {
        assert!(host_matches_bypass(
            "localhost",
            "localhost;127.*;<local>",
            ';',
            true
        ));
        assert!(host_matches_bypass(
            "intranet",
            "localhost;127.*;<local>",
            ';',
            true
        ));
        assert!(!host_matches_bypass(
            "huangguoai.com",
            "localhost;127.*;*.lan;<local>",
            ';',
            true
        ));
        assert!(host_matches_bypass(
            "api.internal.lan",
            "*.lan",
            ';',
            true
        ));
        assert!(host_matches_bypass(
            "sub.example.com",
            ".example.com",
            ',',
            false
        ));
    }

    #[test]
    fn public_query_params_sort_stably() {
        assert_eq!(
            sorted_public_path("/api/videos?size=10&page=1"),
            "/api/videos?page=1&size=10"
        );
        assert_eq!(sorted_public_path("/api/ranks/hot"), "/api/ranks/hot");
    }

    #[test]
    fn pinned_clients_expire_without_extending_the_dns_ttl() {
        let now = Instant::now();
        let client = Arc::new(reqwest::Client::new());
        let mut cache = ClientCache::new();
        cache.insert(
            "true:example.com:443".into(),
            (now + CLIENT_TTL, client.clone()),
        );
        assert!(Arc::ptr_eq(
            &cached_client(
                &cache,
                "true:example.com:443",
                now + Duration::from_secs(29)
            )
            .unwrap(),
            &client
        ));
        assert!(cached_client(&cache, "true:example.com:443", now + CLIENT_TTL).is_none());
        assert!(cached_client(&cache, "false:example.com:443", now).is_none());
        assert!(cached_client(&cache, "true:example.com:8443", now).is_none());
    }

    #[test]
    fn edge_redirects_only_replay_anonymous_reads() {
        let current = url::Url::parse("https://huangguoai.com/api/public/request").unwrap();
        assert_eq!(
            edge_redirect_target(
                &current,
                301,
                "https://huangguodrama.io/api/public/request",
                true
            )
            .unwrap()
            .host_str(),
            Some("huangguodrama.io")
        );
        assert!(edge_redirect_target(&current, 302, "/next", true).is_ok());
        for status in [301, 302, 303, 307, 308] {
            assert!(edge_redirect_target(&current, status, "/next", false).is_err());
        }
        for status in [307, 308] {
            assert!(edge_redirect_target(&current, status, "/next", true).is_err());
        }
        assert!(edge_redirect_target(&current, 301, "http://example.com/", true).is_err());
        assert!(edge_redirect_target(&current, 301, "https://127.0.0.1/", true).is_err());
    }

    #[test]
    fn proxy_credentials_and_query_are_redacted() {
        assert_eq!(
            redact_proxy("http://alice:p%40ss@127.0.0.1:7897/path?token=secret#hidden"),
            "http://127.0.0.1:7897"
        );
        assert_eq!(
            redact_proxy("socks5://alice:secret@[::1]:1080"),
            "socks5://[::1]:1080"
        );
        assert_eq!(
            redact_windows_proxy_server("127.0.0.1:7897"),
            "http://127.0.0.1:7897"
        );
        assert_eq!(
            redact_windows_proxy_server("alice:secret@127.0.0.1:7897"),
            "[已配置，原始值已隐藏]"
        );
        for raw in ["alice:secret@127.0.0.1:7897", "not a url secret", ""] {
            assert_eq!(redact_proxy(raw), "[已配置，原始值已隐藏]");
        }
    }

    #[test]
    fn base_requires_https_origin_and_auth_trust_is_static() {
        assert_eq!(
            normalize_base("https://HUANGGUOAI.COM:443/"),
            Some(DEFAULT_BASE.into())
        );
        for raw in [
            "http://huangguoai.com",
            "https://user:pass@huangguoai.com",
            "https://huangguoai.com/path",
            "https://huangguoai.com/?secret=1",
            "https://huangguoai.com/#fragment",
            "https://192.168.1.1",
        ] {
            assert_eq!(normalize_base(raw), None, "{raw}");
        }
        assert!(trusted_auth_origin(DEFAULT_BASE));
        assert!(trusted_auth_origin(FALLBACK_FIXED_BASE));
        assert!(!trusted_auth_origin("https://mirror.example"));
        assert!(!trusted_auth_origin("https://huangguoai.com.evil.example"));
    }

    #[tokio::test]
    async fn untrusted_origins_reject_credentials_before_network() {
        for (path, body, token) in [
            (
                "/api/account/loginByPassword",
                Some(json!({"password":"secret"})),
                None,
            ),
            (
                "/api/account/registerByPassword",
                Some(json!({"password":"secret"})),
                None,
            ),
            ("/api/videos", None, Some("secret-token")),
        ] {
            let err = edge("https://mirror.invalid", "POST", path, body, token)
                .await
                .unwrap_err();
            assert!(err.contains("镜像线路仅供游客浏览"));
        }
    }

    #[tokio::test]
    async fn private_get_is_rejected_before_network() {
        let err = get(
            "http://127.0.0.1:1/private",
            Duration::from_secs(1),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("禁止访问"));
    }

    /// 手动跑：`cargo test --lib -- --ignored net::tests::diag -- --nocapture`
    /// 关掉 TUN、只留系统代理时跑一遍，能直接看出客户端有没有走代理。
    #[tokio::test]
    #[ignore = "联网测试：请求上游做网络自检，手动用 --ignored 运行"]
    async fn diag() {
        println!(
            "{}",
            serde_json::to_string_pretty(&diagnose().await).expect("json")
        );
    }
}

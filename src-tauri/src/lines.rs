//! 线路（数据源）：固定线路 + 地址发布页/中转页上的镜像线路。
//!
//! 上游只是域名在变，请求链路与数据模型完全一致，所以「切线路」等价于换 `net::base()`。
//! 镜像地址优先从官方发布页（`huangguo88.pages.dev` / `huang-guo.pages.dev` / `huangguoai.pages.dev`）
//! 的 `publish.js` 解析，全部不可达时回退到官方中转页（`hgai42.com` / `huangguoai.ai`）。

use serde_json::{json, Value};
use std::time::{Duration, Instant};

/// 固定线路：写死在客户端里，不依赖任何外部页面。
pub const FIXED: [(&str, &str); 2] = [
    ("固定线路 1", "https://huangguoai.com"),
    ("固定线路 2", "https://huangguodrama.io"),
];

const PUBLISH_PAGES: [&str; 3] = [
    "https://huangguo88.pages.dev/",
    "https://huang-guo.pages.dev/",
    "https://huangguoai.pages.dev/",
];
const TRANSIT_PAGES: [&str; 2] = ["https://hgai42.com/", "https://huangguoai.ai/"];
const TRANSIT_SUBDOMAINS: [&str; 6] = ["thu", "pku", "fdu", "sjtu", "zju", "nju"];
/// 镜像列表上限（子域 × 域名是笛卡尔积，界面只展示这么多）
const MIRROR_MAX: usize = 60;
/// 单条线路探测超时
const PROBE_TIMEOUT: Duration = Duration::from_secs(8);

pub fn fixed() -> Value {
    json!(FIXED
        .iter()
        .map(|(name, url)| json!({ "name": name, "url": url }))
        .collect::<Vec<_>>())
}

fn build_mirror_items(domains: Vec<String>, subs: Vec<String>) -> Vec<Value> {
    let mut items: Vec<Value> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    'outer: for domain in domains {
        let domain = domain.trim_end_matches('/').to_string();
        if domain.is_empty() {
            continue;
        }
        let hosts: Vec<String> = if subs.is_empty() {
            vec![domain.clone()]
        } else {
            subs.iter().map(|s| format!("{s}.{domain}")).collect()
        };
        for host in hosts {
            if crate::net::normalize_base(&format!("https://{host}")).is_none() {
                continue;
            }
            if !seen.insert(host.clone()) {
                continue;
            }
            items.push(json!({ "url": format!("https://{host}"), "host": host }));
            if items.len() >= MIRROR_MAX {
                break 'outer;
            }
        }
    }
    items
}

fn extract_attr_values(html: &str, attr: &str) -> Vec<String> {
    let needle = format!("{attr}=\"");
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(i) = rest.find(&needle) {
        let after = &rest[i + needle.len()..];
        let Some(end) = after.find('"') else {
            break;
        };
        let value = after[..end].trim();
        if !value.is_empty() {
            out.push(value.to_string());
        }
        rest = &after[end + 1..];
    }
    out
}

fn parse_transit_mirrors(html: &str) -> Vec<Value> {
    let mut items = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for host in extract_attr_values(html, "data-route-share-host") {
        if crate::net::normalize_base(&format!("https://{host}")).is_some()
            && seen.insert(host.clone())
        {
            items.push(json!({ "url": format!("https://{host}"), "host": host }));
        }
    }
    let tails = extract_attr_values(html, "data-route-prefix-tail");
    let subs: Vec<String> = TRANSIT_SUBDOMAINS.iter().map(|s| s.to_string()).collect();
    for item in build_mirror_items(tails, subs) {
        if let Some(host) = item["host"].as_str() {
            if seen.insert(host.to_string()) {
                items.push(item);
                if items.len() >= MIRROR_MAX {
                    break;
                }
            }
        }
    }
    items
}

async fn try_publish_page(page: &str) -> Result<Value, String> {
    let html = get_text(page).await?;
    let js_rel = script_src(&html).unwrap_or_else(|| "publish.js".to_string());
    let js_url = absolute(page, &js_rel);
    let js = get_text(&js_url).await?;

    let domains = js_array(&js, "var urls");
    let subs = js_array(&js, "var subdomains");
    if domains.is_empty() {
        return Err("地址发布页格式有变化：没找到镜像域名".to_string());
    }
    let items = build_mirror_items(domains, subs);
    if items.is_empty() {
        return Err("地址发布页里没有可用的镜像地址".to_string());
    }
    Ok(json!({ "source": page, "script": js_url, "items": items }))
}

/// 拉地址发布页 → 解析 publish.js → 拼出镜像地址（失败自动尝试备用发布页与中转页）。
/// 只在用户点开「线路」时调用。
pub async fn mirrors() -> Result<Value, String> {
    let mut last_err = String::from("镜像线路获取失败");
    for page in PUBLISH_PAGES {
        match try_publish_page(page).await {
            Ok(v) => return Ok(v),
            Err(e) => last_err = e,
        }
    }
    for page in TRANSIT_PAGES {
        if let Ok(html) = get_text(page).await {
            let items = parse_transit_mirrors(&html);
            if !items.is_empty() {
                return Ok(json!({ "source": page, "items": items }));
            }
        }
    }
    Err(last_err)
}

/// 可达性探测（并发 6 条一组）。只报结果，不做自动切换。
pub async fn probe(urls: Vec<String>) -> Value {
    let mut out: Vec<Value> = Vec::new();
    for chunk in urls.chunks(6) {
        let mut handles = Vec::new();
        for u in chunk {
            let u = u.clone();
            handles.push(tokio::spawn(async move { probe_one(u).await }));
        }
        for h in handles {
            if let Ok(v) = h.await {
                out.push(v);
            }
        }
    }
    json!(out)
}

/// 真实探测线路的公共业务接口（而非只看 `/` 是否返回 200，避免中转页被误判为可用站点）。
async fn probe_one(url: String) -> Value {
    let Some(origin) = crate::net::normalize_base(&url) else {
        return json!({ "url": url, "ok": false, "ms": 0, "error": "线路地址无效" });
    };
    let started = Instant::now();
    let res = tokio::time::timeout(
        PROBE_TIMEOUT,
        crate::net::edge(&origin, "GET", "/api/site/categories/video", None, None),
    )
    .await;
    let ms = started.elapsed().as_millis() as u64;
    match res {
        Ok(Ok(_)) => json!({ "url": url, "ok": true, "status": 200, "ms": ms }),
        Ok(Err(e)) => {
            let status = e
                .strip_prefix("HTTP ")
                .and_then(|s| s.split(|c: char| !c.is_ascii_digit()).next())
                .and_then(|d| d.parse::<u16>().ok());
            json!({ "url": url, "ok": false, "status": status, "ms": ms, "error": e })
        }
        Err(_) => json!({ "url": url, "ok": false, "ms": ms, "error": "请求超时" }),
    }
}

async fn get_text(url: &str) -> Result<String, String> {
    let resp = crate::net::get(url, Duration::from_secs(8), None, None).await?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.text().await.map_err(|e| crate::net::err_text(&e))
}

/// 从 HTML 里挑出脚本地址（发布页只有一个 `publish.js?<版本>`）。
fn script_src(html: &str) -> Option<String> {
    let mut rest = html;
    while let Some(i) = rest.find("src=\"") {
        let after = &rest[i + 5..];
        let end = after.find('"')?;
        let candidate = &after[..end];
        if candidate.contains(".js") {
            return Some(candidate.to_string());
        }
        rest = &after[end..];
    }
    None
}

fn absolute(base: &str, rel: &str) -> String {
    if rel.starts_with("http://") || rel.starts_with("https://") {
        return rel.to_string();
    }
    let origin = url::Url::parse(base)
        .ok()
        .map(|u| format!("{}://{}", u.scheme(), u.host_str().unwrap_or_default()));
    match origin {
        Some(o) if rel.starts_with('/') => format!("{o}{rel}"),
        Some(o) => format!("{o}/{rel}"),
        None => rel.to_string(),
    }
}

/// 取 JS 里 `var <name> = [ ... ]` 的字符串数组（去掉行尾 `//` 注释，但保留字符串里的 `//`）。
fn js_array(src: &str, decl: &str) -> Vec<String> {
    let Some(at) = src.find(decl) else {
        return Vec::new();
    };
    let rest = &src[at..];
    let Some(open) = rest.find('[') else {
        return Vec::new();
    };
    let Some(close) = rest[open..].find(']') else {
        return Vec::new();
    };
    strip_line_comments(&rest[open + 1..open + close])
        .split(',')
        .map(|raw| {
            raw.trim()
                .trim_matches(|c: char| c == '\'' || c == '"')
                .trim()
                .to_string()
        })
        .filter(|s| !s.is_empty())
        .collect()
}

/// 去掉 `//` 行尾注释（引号内的 `//` 是 URL，不能动）。
fn strip_line_comments(body: &str) -> String {
    let mut out = String::with_capacity(body.len());
    let mut quote: Option<char> = None;
    let mut chars = body.chars().peekable();
    while let Some(c) = chars.next() {
        match quote {
            Some(q) => {
                out.push(c);
                if c == q {
                    quote = None;
                }
            }
            None => {
                if c == '\'' || c == '"' {
                    quote = Some(c);
                    out.push(c);
                } else if c == '/' && chars.peek() == Some(&'/') {
                    for n in chars.by_ref() {
                        if n == '\n' {
                            out.push('\n');
                            break;
                        }
                    }
                } else {
                    out.push(c);
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
var subdomains = [
    'thu',  // 清华
    'pku',  // 北大
];
var urls=[
	'xxbgwypx.cc/',
];
var otherUrls = [
	'https://huangguoai.pages.dev',
];
var foreverUrls = [
	  'https://huangguoai.com',
	JumpPage,
	'https://huangguoai.ai',
];
"#;

    #[test]
    fn parses_publish_js_arrays() {
        assert_eq!(js_array(SAMPLE, "var urls"), vec!["xxbgwypx.cc/"]);
        assert_eq!(js_array(SAMPLE, "var subdomains"), vec!["thu", "pku"]);
        assert_eq!(
            js_array(SAMPLE, "var foreverUrls"),
            vec![
                "https://huangguoai.com",
                "JumpPage",
                "https://huangguoai.ai"
            ]
        );
    }

    #[test]
    fn parses_transit_route_cards() {
        let html = r#"<article data-route-share-host="dc5.aqkmowihz.cc" data-route-prefix-tail="aqkmowihz.cc"></article>"#;
        let items = parse_transit_mirrors(html);
        assert!(items.iter().any(|i| i["host"] == "dc5.aqkmowihz.cc"));
        assert!(items.iter().any(|i| i["host"] == "thu.aqkmowihz.cc"));
    }

    #[test]
    fn resolves_relative_script() {
        assert_eq!(
            absolute("https://huangguoai.pages.dev/", "publish.js?20261103-2"),
            "https://huangguoai.pages.dev/publish.js?20261103-2"
        );
        assert_eq!(
            absolute("https://huangguoai.pages.dev/", "/a/b.js"),
            "https://huangguoai.pages.dev/a/b.js"
        );
    }

    #[test]
    fn picks_script_src() {
        let html = r#"<link rel="stylesheet" href="publish.css?1" /><script type="text/javascript" src="publish.js?20261103-2"></script>"#;
        assert_eq!(script_src(html).as_deref(), Some("publish.js?20261103-2"));
    }

    /// 手动跑：`cargo test --lib -- --ignored lines::tests::mirrors_live -- --nocapture`
    #[tokio::test]
    #[ignore = "联网测试：请求上游镜像列表，手动用 --ignored 运行"]
    async fn mirrors_live() {
        match mirrors().await {
            Ok(v) => println!("{}", serde_json::to_string_pretty(&v).expect("json")),
            Err(e) => panic!("mirrors failed: {e}"),
        }
    }

    /// 手动跑：`cargo test --lib -- --ignored lines::tests::probe_live -- --nocapture`
    #[tokio::test]
    #[ignore = "联网测试：探测上游线路连通性，手动用 --ignored 运行"]
    async fn probe_live() {
        let urls = vec![
            "https://huangguoai.com".to_string(),
            "https://huangguodrama.io".to_string(),
            "https://huangguoai.ai".to_string(),
            "https://thu.aqkmowihz.cc".to_string(),
        ];
        println!(
            "{}",
            serde_json::to_string_pretty(&probe(urls).await).expect("json")
        );
    }
}

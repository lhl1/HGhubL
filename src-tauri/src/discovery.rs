//! Public home and discovery routes use the existing transport and selected origin.
use crate::api::Api;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;

fn paging(page: u32, size: u32) -> String {
    format!("page={}&size={}", page.clamp(1, 10000), size.clamp(1, 50))
}
fn slug(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || value.len() > 160
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("内容标识无效".into());
    }
    Ok(value)
}
fn videos_path(section: &str, page: u32, size: u32) -> Result<String, String> {
    let query = paging(page, size);
    Ok(match section {
        "hot" => "/api/ranks/hot".to_string(),
        "short" => format!("/api/videos/category/ai-duanju?{query}"),
        "comic" => format!("/api/videos/category/ai-manju?{query}"),
        _ => return Err("探索分区无效".into()),
    })
}
fn original_path(section: &str, page: u32) -> Result<String, String> {
    let category = match section {
        "original" => "",
        "original-short" => "duanju/",
        "original-comic" => "manju/",
        _ => return Err("原创分类无效".into()),
    };
    let page = page.clamp(1, 10000);
    Ok(if page == 1 {
        format!("/original/{category}")
    } else {
        format!("/original/{category}{page}/")
    })
}
fn site_path(section: &str, page: u32) -> Result<String, String> {
    if let Some(value) = section.strip_prefix("topic:") {
        return topic_path(value, page, 20);
    }
    if let Some(value) = section.strip_prefix("tag:") {
        return tag_path(value, page, 20);
    }
    if section == "home" {
        return Ok("/".into());
    }
    if section.starts_with("original") {
        return original_path(section, page);
    }
    let route = match section {
        "recommend" => "recommend",
        "latest" => "newest",
        "short" => "ai-duanju",
        "comic" => "ai-manju",
        "short-hot" => "ai-duanju/hot",
        "comic-hot" => "ai-manju/hot",
        _ => return Err("网页分区无效".into()),
    };
    let page = page.clamp(1, 10000);
    Ok(if page == 1 {
        format!("/{route}/")
    } else {
        format!("/{route}/{page}/")
    })
}
async fn site_listing(section: &str, page: u32) -> Result<Value, String> {
    // The public original page has its own membership and paging. The generic
    // is_original API filter currently fails upstream; do not replace it with
    // an unrelated publisher sort or filter a single page of general videos.
    let origin = crate::net::base();
    let mut response = crate::net::get(
        &format!("{origin}{}", site_path(section, page)?),
        Duration::from_secs(20),
        Some("text/html"),
        Some(&origin),
    )
    .await?;
    if !response.status().is_success() {
        return Err(format!("列表页面加载失败 (HTTP {})", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > 2 * 1024 * 1024)
    {
        return Err("列表页面过大，请重试".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| crate::net::err_text(&error))?
    {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("列表页面过大，请重试".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if crate::net::base() != origin {
        return Err("线路已变化，请重试".into());
    }
    let html = String::from_utf8(bytes).map_err(|_| "列表页面编码无效".to_string())?;
    Ok(json!({"html": html, "origin": origin, "section": section, "page": page.clamp(1, 10000)}))
}
async fn discover(api: &Api, section: &str, page: u32, size: u32) -> Result<Value, String> {
    // A listing keeps one source and page size for its entire pagination session.
    // Mixing an API page of 20 with a web page of 40 would skip member videos.
    if matches!(
        section,
        "recommend"
            | "latest"
            | "original"
            | "original-short"
            | "original-comic"
            | "short"
            | "comic"
    ) {
        return site_listing(section, page).await;
    }
    match api.get(&videos_path(section, page, size)?).await {
        Ok(data) if data["items"].is_array() => Ok(data),
        Err(error) => Err(error),
        _ => Err("接口返回无效列表，请重试".into()),
    }
}
fn topic_path(value: &str, page: u32, _size: u32) -> Result<String, String> {
    let value = slug(value)?;
    Ok(if page <= 1 {
        format!("/topics/{value}/")
    } else {
        format!("/topics/{value}/{}/", page.clamp(1, 10000))
    })
}
pub(crate) async fn catalog_listing(
    api: &Api,
    category: &str,
    sort: &str,
    page: u32,
) -> Option<Result<Value, String>> {
    let section = match (category, sort) {
        ("", "") => "latest",
        ("", "hot") => "hot",
        ("", "original") => "original",
        ("ai-duanju", "") => "short",
        ("ai-manju", "") => "comic",
        ("ai-duanju", "hot") => "short-hot",
        ("ai-manju", "hot") => "comic-hot",
        ("ai-duanju", "original") => "original-short",
        ("ai-manju", "original") => "original-comic",
        _ => return None,
    };
    Some(if section == "hot" {
        api.get("/api/ranks/hot").await
    } else {
        site_listing(section, page).await
    })
}
fn tag_path(value: &str, page: u32, _size: u32) -> Result<String, String> {
    let value = slug(value)?;
    Ok(if page <= 1 {
        format!("/tag/{value}/")
    } else {
        format!("/tag/{value}/{}/", page.clamp(1, 10000))
    })
}
fn posts_path(category: &str, page: u32, size: u32) -> Result<String, String> {
    let query = paging(page, size);
    if category.is_empty() {
        Ok(format!("/api/posts?{query}"))
    } else {
        Ok(format!("/api/posts/category/{}?{query}", slug(category)?))
    }
}

#[tauri::command]
pub async fn api_home(state: State<'_, Api>) -> Result<Value, String> {
    let _ = state;
    site_listing("home", 1).await
}
#[tauri::command]
pub async fn api_discover(
    state: State<'_, Api>,
    section: String,
    page: u32,
    size: u32,
) -> Result<Value, String> {
    discover(&state, &section, page, size).await
}
#[tauri::command]
pub async fn api_search_hot(state: State<'_, Api>) -> Result<Value, String> {
    state.get("/api/search/hot").await
}
#[tauri::command]
pub async fn api_topics(state: State<'_, Api>, page: u32, size: u32) -> Result<Value, String> {
    state
        .get(&format!("/api/topics?{}", paging(page, size)))
        .await
}
#[tauri::command]
pub async fn api_topic(
    state: State<'_, Api>,
    slug: String,
    page: u32,
    size: u32,
) -> Result<Value, String> {
    let _ = (state, size);
    site_listing(&format!("topic:{}", self::slug(&slug)?), page).await
}
#[tauri::command]
pub async fn api_tag(
    state: State<'_, Api>,
    slug: String,
    page: u32,
    size: u32,
) -> Result<Value, String> {
    let _ = (state, size);
    site_listing(&format!("tag:{}", self::slug(&slug)?), page).await
}
#[tauri::command]
pub async fn api_post_categories(state: State<'_, Api>) -> Result<Value, String> {
    state.get("/api/site/categories/post").await
}
#[tauri::command]
pub async fn api_discover_posts(
    state: State<'_, Api>,
    category: String,
    page: u32,
    size: u32,
) -> Result<Value, String> {
    state.get(&posts_path(&category, page, size)?).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "Network smoke: native catalog uses the actual public web sources"]
    async fn catalog_live() {
        let api = Api::new();
        for (category, sort) in [("", ""), ("ai-duanju", "hot"), ("ai-manju", "original")] {
            let data = catalog_listing(&api, category, sort, 1)
                .await
                .unwrap()
                .unwrap();
            assert!(data["html"].as_str().unwrap().contains("hg-drama-card"));
        }
        println!("Catalog all/new, short/hot and comic/original public lists OK");
    }
    #[tokio::test]
    #[ignore = "Network smoke: home, discovery paging, topics, tags and post categories"]
    async fn discovery_live() {
        async fn get(path: &str) -> Value {
            crate::net::edge(&crate::net::base(), "GET", path, None, None)
                .await
                .unwrap_or_else(|error| panic!("{path}: {error}"))
        }
        let home = site_listing("home", 1).await.unwrap();
        assert!(home["html"].as_str().unwrap().contains("data-hero-slides"));
        let api = Api::new();
        for section in ["recommend", "latest", "hot", "short", "comic"] {
            let first = discover(&api, section, 1, 20).await.unwrap();
            assert!(
                first["items"]
                    .as_array()
                    .is_some_and(|items| !items.is_empty())
                    || first["html"]
                        .as_str()
                        .is_some_and(|html| html.contains("hg-drama-card")),
                "{section} has no records"
            );
            if matches!(section, "recommend" | "latest") {
                let next = discover(&api, section, 2, 20).await.unwrap();
                assert_eq!(next["page"].as_u64(), Some(2));
                if first["items"].is_array() && next["items"].is_array() {
                    assert_ne!(
                        first["items"][0]["id"], next["items"][0]["id"],
                        "{section} repeated page one"
                    );
                }
                if next["html"].is_string() {
                    assert!(next["html"].as_str().unwrap().contains("hg-drama-card"));
                }
            }
            println!("Discovery {section}: live records and pagination contract OK");
        }
        for section in ["original", "original-short", "original-comic"] {
            let page = site_listing(section, 1).await.unwrap();
            assert!(page["html"].as_str().unwrap().contains("hg-drama-card"));
            println!("Original public page {section}: membership and native listing source OK");
        }
        let topics = get("/api/topics?page=1&size=2").await;
        let topic_slug = topics["items"][0]["slug"].as_str().unwrap();
        let detail = site_listing(&format!("topic:{topic_slug}"), 1)
            .await
            .unwrap();
        assert!(detail["html"].as_str().unwrap().contains("hg-topic-banner"));
        let tag_slug = home["html"]
            .as_str()
            .unwrap()
            .split("href=\"/tag/")
            .nth(1)
            .unwrap()
            .split('/')
            .next()
            .unwrap();
        assert!(
            site_listing(&format!("tag:{tag_slug}"), 1).await.unwrap()["html"]
                .as_str()
                .unwrap()
                .contains("hg-drama-card")
        );
        let categories = get("/api/site/categories/post").await;
        for category in categories["items"].as_array().unwrap() {
            let route = category["route"].as_str().unwrap();
            let posts = get(&posts_path(route, 1, 2).unwrap()).await;
            assert!(posts["items"].is_array());
            if let Some(id) = posts["items"][0]["id"].as_i64() {
                assert!(get(&format!("/api/posts/{id}")).await["content"].is_string());
            }
        }
        assert!(get("/api/search/hot").await["items"].is_array());
        println!("Home, topic detail, tag catalog, all post categories and article details OK");
    }
    #[test]
    fn discovery_uses_public_site_sections_with_bounded_pages() {
        assert_eq!(
            videos_path("short", 0, 1000).unwrap(),
            "/api/videos/category/ai-duanju?page=1&size=50"
        );
        assert_eq!(site_path("latest", 2).unwrap(), "/newest/2/");
        assert_eq!(original_path("original", 1).unwrap(), "/original/");
        assert_eq!(
            original_path("original-short", 2).unwrap(),
            "/original/duanju/2/"
        );
        assert_eq!(
            original_path("original-comic", 1).unwrap(),
            "/original/manju/"
        );
        assert!(original_path("../private", 1).is_err());
        assert!(videos_path("unknown", 1, 20).is_err());
    }
    #[test]
    fn topic_tag_and_article_routes_cannot_escape_their_section() {
        for value in [
            "",
            "../private",
            "a/b",
            "x?admin=1",
            "https://host",
            "a%2fb",
            "a\n",
        ] {
            assert!(topic_path(value, 1, 20).is_err());
            assert!(tag_path(value, 1, 20).is_err());
            if !value.is_empty() {
                assert!(posts_path(value, 1, 20).is_err());
            }
        }
        assert_eq!(
            topic_path("sample-topic", 2, 20).unwrap(),
            "/topics/sample-topic/2/"
        );
        assert_eq!(
            posts_path("reviews", 1, 12).unwrap(),
            "/api/posts/category/reviews?page=1&size=12"
        );
        assert_eq!(posts_path("", 1, 12).unwrap(), "/api/posts?page=1&size=12");
    }
}

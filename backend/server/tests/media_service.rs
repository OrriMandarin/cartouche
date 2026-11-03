//! The media storage service over an in-memory store (Task 7).

mod common;

use bytes::Bytes;
use cartouche_api::media::MediaService;
use url::Url;
use uuid::Uuid;

fn service() -> MediaService {
    MediaService::in_memory("http://localhost:3000/media/".parse::<Url>().unwrap())
}

// spec: MED-016
#[tokio::test]
async fn in_memory_service_round_trip() {
    let media = service();
    let (card, other_card) = (Uuid::now_v7(), Uuid::now_v7());
    let (first, second) = (Uuid::now_v7(), Uuid::now_v7());
    let key = |card: Uuid, media: Uuid, name: &str| format!("cards/{card}/{media}/{name}");

    media
        .put(
            &key(card, first, "s256.webp"),
            Bytes::from_static(b"abcdef"),
        )
        .await
        .unwrap();
    media
        .put(&key(card, second, "w640.webp"), Bytes::from_static(b"xyz"))
        .await
        .unwrap();
    media
        .put(
            &key(other_card, first, "s256.webp"),
            Bytes::from_static(b"keep"),
        )
        .await
        .unwrap();

    let whole = media
        .get(&key(card, first, "s256.webp"), None)
        .await
        .unwrap();
    assert_eq!((whole.bytes.as_ref(), whole.size), (&b"abcdef"[..], 6));
    let part = media
        .get(&key(card, first, "s256.webp"), Some(0..2))
        .await
        .unwrap();
    assert_eq!((part.bytes.as_ref(), part.size), (&b"ab"[..], 6));

    media
        .copy(
            &key(card, first, "s256.webp"),
            &key(card, first, "copy.webp"),
        )
        .await
        .unwrap();
    assert_eq!(media.list_keys().await.len(), 4);

    media.delete_media(card, first).await.unwrap();
    let mut left = media.list_keys().await;
    left.sort();
    assert_eq!(left, {
        let mut expected = vec![
            key(card, second, "w640.webp"),
            key(other_card, first, "s256.webp"),
        ];
        expected.sort();
        expected
    });

    media.delete_card(card).await.unwrap();
    assert_eq!(
        media.list_keys().await,
        [key(other_card, first, "s256.webp")]
    );
    // Deleting what is already gone is not an error.
    media.delete_card(card).await.unwrap();
}

// spec: MED-016
#[tokio::test]
async fn missing_object_is_not_found() {
    let err = service()
        .get("cards/nope/x/s256.webp", None)
        .await
        .unwrap_err();
    assert!(
        matches!(err, cartouche_api::media::MediaError::NotFound),
        "{err:?}"
    );
}

// spec: MED-010, MED-011
#[tokio::test]
async fn urls_join_the_base_with_exactly_one_slash() {
    let local = service();
    assert!(local.serves_locally());
    assert_eq!(
        local.url("cards/a/b/s256.webp"),
        "http://localhost:3000/media/cards/a/b/s256.webp"
    );
    let remote = MediaService::in_memory_remote("https://cdn.example".parse().unwrap());
    assert!(!remote.serves_locally());
    assert_eq!(
        remote.url("cards/a/b/s256.webp"),
        "https://cdn.example/cards/a/b/s256.webp"
    );
    let remote = MediaService::in_memory_remote("https://cdn.example/bucket/".parse().unwrap());
    assert_eq!(remote.url("k"), "https://cdn.example/bucket/k");
}

// spec: MED-009, MED-010
#[tokio::test]
async fn local_storage_writes_under_the_configured_directory() {
    use cartouche_api::config::MediaStorageConfig;

    let dir = std::env::temp_dir().join(format!("cartouche-media-{}", Uuid::now_v7()));
    let config = MediaStorageConfig::Local { dir: dir.clone() };
    let media =
        MediaService::from_config(&config, &"https://cartouche.example".parse().unwrap()).unwrap();
    assert!(dir.is_dir(), "the directory is created at startup");
    assert!(media.serves_locally());
    assert_eq!(
        media.url("cards/a/b/video.mp4"),
        "https://cartouche.example/media/cards/a/b/video.mp4"
    );

    media
        .put("cards/a/b/video.mp4", Bytes::from_static(b"0123456789"))
        .await
        .unwrap();
    assert_eq!(
        std::fs::read(dir.join("cards/a/b/video.mp4")).unwrap(),
        b"0123456789"
    );
    let part = media.get("cards/a/b/video.mp4", Some(2..5)).await.unwrap();
    assert_eq!((part.bytes.as_ref(), part.size), (&b"234"[..], 10));
    assert_eq!(media.list_keys().await, ["cards/a/b/video.mp4"]);
    std::fs::remove_dir_all(dir).unwrap();
}

// spec: MED-009, MED-011
#[test]
fn s3_storage_builds_without_touching_the_network() {
    use cartouche_api::config::{MediaStorageConfig, Secret};

    let config = MediaStorageConfig::S3 {
        bucket: "cards".into(),
        region: "eu-west-3".into(),
        endpoint: Some("http://localhost:9000".parse().unwrap()),
        access_key_id: "key".into(),
        secret_access_key: Secret::new("secret"),
        public_base_url: "https://cdn.example".parse().unwrap(),
    };
    let media =
        MediaService::from_config(&config, &"https://cartouche.example".parse().unwrap()).unwrap();
    assert!(!media.serves_locally());
    assert_eq!(media.url("cards/a"), "https://cdn.example/cards/a");
}

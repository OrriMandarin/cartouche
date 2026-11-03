use std::collections::HashSet;
use std::net::SocketAddr;
use std::path::PathBuf;

use cartouche_domain::SignupMode;
use thiserror::Error;
use url::Url;

/// `MAX_SIMULTANEOUS_EVENTS` when the variable is absent (EVT-019).
const DEFAULT_MAX_SIMULTANEOUS_EVENTS: usize = 3;

/// Upper bound of `TRUSTED_PROXY_HOPS`.
const MAX_TRUSTED_PROXY_HOPS: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppEnv {
    Development,
    Test,
    Production,
}

impl AppEnv {
    /// Absent or unrecognized values mean `Production`: the safe default.
    pub fn parse(value: Option<&str>) -> AppEnv {
        match value.map(str::trim) {
            Some("development") => AppEnv::Development,
            Some("test") => AppEnv::Test,
            _ => AppEnv::Production,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthConfig {
    pub issuer: String,
    pub jwks_url: Url,
    pub audience: Option<String>,
}

/// A value that must never be printed: `Debug` shows `***`.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Secret {
        Secret(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("\"***\"")
    }
}

/// Where media files are stored (MED-009).
// Built once at startup: boxing the S3 variant would only complicate the type.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MediaStorageConfig {
    /// A directory on the API host, served by the API under `/media/*`.
    Local { dir: PathBuf },
    /// An S3-compatible bucket, served from `public_base_url` (MED-011).
    S3 {
        bucket: String,
        region: String,
        /// Custom endpoint for S3-compatible services (MinIO, R2...); AWS when absent.
        endpoint: Option<Url>,
        access_key_id: String,
        secret_access_key: Secret,
        public_base_url: Url,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub app_env: AppEnv,
    pub database_url: String,
    pub bind_addr: SocketAddr,
    pub public_base_url: Url,
    pub auth: AuthConfig,
    pub admin_user_ids: HashSet<String>,
    pub signup_mode: SignupMode,
    pub sentry_dsn: Option<String>,
    pub media: MediaStorageConfig,
    /// Reverse proxies in front of the API whose `X-Forwarded-For` entry is trusted (ABU-008).
    pub trusted_proxy_hops: usize,
    /// Most events of one card that may run at the same instant (EVT-004, EVT-019).
    pub max_simultaneous_events: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ConfigError {
    #[error("missing required environment variable {0}")]
    Missing(String),
    #[error("invalid value for {0}: {1}")]
    Invalid(String, String),
}

impl Config {
    pub fn from_env() -> Result<Config, ConfigError> {
        Config::from_vars(|name| std::env::var(name).ok())
    }

    pub fn from_vars(get: impl Fn(&str) -> Option<String>) -> Result<Config, ConfigError> {
        let optional = |name: &str| get(name).filter(|v| !v.trim().is_empty());
        let required =
            |name: &str| optional(name).ok_or_else(|| ConfigError::Missing(name.to_string()));
        fn invalid(name: &str, e: impl std::fmt::Display) -> ConfigError {
            ConfigError::Invalid(name.to_string(), e.to_string())
        }

        let app_env = AppEnv::parse(get("APP_ENV").as_deref());
        let database_url = required("DATABASE_URL")?;
        let issuer = required("AUTH_ISSUER")?;
        let jwks_url = required("AUTH_JWKS_URL")?
            .parse::<Url>()
            .map_err(|e| invalid("AUTH_JWKS_URL", e))?;
        let public_base_url = required("PUBLIC_BASE_URL")?
            .parse::<Url>()
            .map_err(|e| invalid("PUBLIC_BASE_URL", e))?;
        let bind_addr = get("BIND_ADDR")
            .unwrap_or_else(|| "0.0.0.0:8080".to_string())
            .parse::<SocketAddr>()
            .map_err(|e| invalid("BIND_ADDR", e))?;
        let signup_mode = match get("SIGNUP_MODE") {
            Some(v) => v
                .parse::<SignupMode>()
                .map_err(|e| invalid("SIGNUP_MODE", e))?,
            None => SignupMode::Approval,
        };
        let admin_user_ids = get("ADMIN_USER_IDS")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_string)
            .collect();

        let trusted_proxy_hops = match optional("TRUSTED_PROXY_HOPS") {
            None => 1,
            Some(v) => v
                .trim()
                .parse::<usize>()
                .ok()
                .filter(|hops| *hops <= MAX_TRUSTED_PROXY_HOPS)
                .ok_or_else(|| {
                    invalid(
                        "TRUSTED_PROXY_HOPS",
                        format!("expected an integer from 0 to {MAX_TRUSTED_PROXY_HOPS}"),
                    )
                })?,
        };

        let max_simultaneous_events = match optional("MAX_SIMULTANEOUS_EVENTS") {
            None => DEFAULT_MAX_SIMULTANEOUS_EVENTS,
            Some(v) => v
                .trim()
                .parse::<usize>()
                .ok()
                .filter(|limit| *limit >= 1)
                .ok_or_else(|| {
                    invalid(
                        "MAX_SIMULTANEOUS_EVENTS",
                        "expected an integer of at least 1",
                    )
                })?,
        };

        let media = match optional("MEDIA_STORAGE").as_deref().map(str::trim) {
            None | Some("local") => MediaStorageConfig::Local {
                dir: optional("MEDIA_LOCAL_DIR")
                    .map_or_else(|| PathBuf::from("./data/media"), PathBuf::from),
            },
            Some("s3") => MediaStorageConfig::S3 {
                bucket: required("MEDIA_S3_BUCKET")?,
                region: required("MEDIA_S3_REGION")?,
                endpoint: optional("MEDIA_S3_ENDPOINT")
                    .map(|v| {
                        v.parse::<Url>()
                            .map_err(|e| invalid("MEDIA_S3_ENDPOINT", e))
                    })
                    .transpose()?,
                access_key_id: required("MEDIA_S3_ACCESS_KEY_ID")?,
                secret_access_key: Secret::new(required("MEDIA_S3_SECRET_ACCESS_KEY")?),
                public_base_url: required("MEDIA_PUBLIC_BASE_URL")?
                    .parse::<Url>()
                    .map_err(|e| invalid("MEDIA_PUBLIC_BASE_URL", e))?,
            },
            Some(other) => {
                return Err(invalid(
                    "MEDIA_STORAGE",
                    format!("expected `local` or `s3`, got `{other}`"),
                ));
            }
        };

        Ok(Config {
            app_env,
            database_url,
            bind_addr,
            public_base_url,
            auth: AuthConfig {
                issuer,
                jwks_url,
                audience: optional("AUTH_AUDIENCE"),
            },
            admin_user_ids,
            signup_mode,
            sentry_dsn: optional("SENTRY_DSN"),
            media,
            trusted_proxy_hops,
            max_simultaneous_events,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    fn vars(extra: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let mut m: HashMap<String, String> = [
            ("DATABASE_URL", "postgres://u:p@localhost/db"),
            ("AUTH_ISSUER", "https://issuer.example.com"),
            (
                "AUTH_JWKS_URL",
                "https://issuer.example.com/.well-known/jwks.json",
            ),
            ("PUBLIC_BASE_URL", "https://cartouche.example.com"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        for (k, v) in extra {
            m.insert((*k).to_string(), (*v).to_string());
        }
        move |k| m.get(k).cloned()
    }

    fn vars_without(missing: &str) -> impl Fn(&str) -> Option<String> {
        let inner = vars(&[]);
        let missing = missing.to_string();
        move |k| if k == missing { None } else { inner(k) }
    }

    #[test]
    fn missing_app_env_means_production() {
        assert_eq!(AppEnv::parse(None), AppEnv::Production);
    }

    #[test]
    fn invalid_app_env_means_production() {
        assert_eq!(AppEnv::parse(Some("dev")), AppEnv::Production);
    }

    #[test]
    fn valid_app_envs_parse() {
        assert_eq!(AppEnv::parse(Some("development")), AppEnv::Development);
        assert_eq!(AppEnv::parse(Some("test")), AppEnv::Test);
        assert_eq!(AppEnv::parse(Some("production")), AppEnv::Production);
    }

    // spec: ACC-012
    #[test]
    fn absent_signup_mode_defaults_to_approval() {
        let c = Config::from_vars(vars(&[])).unwrap();
        assert_eq!(c.signup_mode, SignupMode::Approval);
    }

    #[test]
    fn defaults_apply() {
        let c = Config::from_vars(vars(&[])).unwrap();
        assert_eq!(c.app_env, AppEnv::Production);
        assert_eq!(c.bind_addr, "0.0.0.0:8080".parse().unwrap());
        assert_eq!(c.signup_mode, SignupMode::Approval);
        assert_eq!(c.sentry_dsn, None);
        assert_eq!(c.auth.audience, None);
        assert!(c.admin_user_ids.is_empty());
    }

    // spec: ACC-003
    #[test]
    fn admin_ids_are_trimmed_and_empty_entries_dropped() {
        let c = Config::from_vars(vars(&[("ADMIN_USER_IDS", " a , b,, ")])).unwrap();
        assert_eq!(c.admin_user_ids, HashSet::from(["a".into(), "b".into()]));
    }

    // spec: ACC-003
    #[test]
    fn empty_admin_ids_means_no_admin() {
        let c = Config::from_vars(vars(&[("ADMIN_USER_IDS", "")])).unwrap();
        assert!(c.admin_user_ids.is_empty());
        let c = Config::from_vars(vars(&[("ADMIN_USER_IDS", " , ,")])).unwrap();
        assert!(c.admin_user_ids.is_empty());
    }

    #[test]
    fn missing_required_vars_are_errors() {
        for name in [
            "DATABASE_URL",
            "AUTH_ISSUER",
            "AUTH_JWKS_URL",
            "PUBLIC_BASE_URL",
        ] {
            let err = Config::from_vars(vars_without(name)).unwrap_err();
            assert_eq!(err, ConfigError::Missing(name.to_string()));
        }
    }

    #[test]
    fn blank_required_variable_is_missing() {
        for name in [
            "DATABASE_URL",
            "AUTH_ISSUER",
            "AUTH_JWKS_URL",
            "PUBLIC_BASE_URL",
        ] {
            for blank in ["", "  "] {
                let err = Config::from_vars(vars(&[(name, blank)])).unwrap_err();
                assert_eq!(
                    err,
                    ConfigError::Missing(name.to_string()),
                    "{name}={blank:?}"
                );
            }
        }
    }

    #[test]
    fn missing_database_url_is_an_error() {
        assert_eq!(
            Config::from_vars(vars_without("DATABASE_URL")).unwrap_err(),
            ConfigError::Missing("DATABASE_URL".into())
        );
    }

    #[test]
    fn invalid_values_are_errors() {
        for (name, value) in [
            ("BIND_ADDR", "not-an-addr"),
            ("SIGNUP_MODE", "sometimes"),
            ("PUBLIC_BASE_URL", "not a url"),
            ("AUTH_JWKS_URL", "nope"),
        ] {
            let err = Config::from_vars(vars(&[(name, value)])).unwrap_err();
            assert!(
                matches!(err, ConfigError::Invalid(ref n, _) if n == name),
                "{name}: {err:?}"
            );
        }
    }

    #[test]
    fn empty_optional_vars_are_none() {
        let c = Config::from_vars(vars(&[("SENTRY_DSN", ""), ("AUTH_AUDIENCE", "")])).unwrap();
        assert_eq!(c.sentry_dsn, None);
        assert_eq!(c.auth.audience, None);
        let c = Config::from_vars(vars(&[
            ("SENTRY_DSN", "https://k@sentry.example.com/1"),
            ("AUTH_AUDIENCE", "cartouche"),
            ("SIGNUP_MODE", "closed"),
            ("BIND_ADDR", "127.0.0.1:9000"),
        ]))
        .unwrap();
        assert_eq!(
            c.sentry_dsn.as_deref(),
            Some("https://k@sentry.example.com/1")
        );
        assert_eq!(c.auth.audience.as_deref(), Some("cartouche"));
        assert_eq!(c.signup_mode, SignupMode::Closed);
        assert_eq!(c.bind_addr.port(), 9000);
    }

    // spec: ABU-008
    #[test]
    fn trusted_proxy_hops_configuration() {
        let hops = |value: &str| Config::from_vars(vars(&[("TRUSTED_PROXY_HOPS", value)]));
        assert_eq!(Config::from_vars(vars(&[])).unwrap().trusted_proxy_hops, 1);
        assert_eq!(hops("").unwrap().trusted_proxy_hops, 1);
        assert_eq!(hops("0").unwrap().trusted_proxy_hops, 0);
        assert_eq!(hops(" 2 ").unwrap().trusted_proxy_hops, 2);
        assert_eq!(hops("10").unwrap().trusted_proxy_hops, 10);
        for bad in ["x", "11", "-1", "1.5"] {
            let err = hops(bad).unwrap_err();
            assert!(
                matches!(err, ConfigError::Invalid(ref n, _) if n == "TRUSTED_PROXY_HOPS"),
                "{bad}: {err:?}"
            );
        }
    }

    // spec: EVT-019
    #[test]
    fn max_simultaneous_events_configuration() {
        let limit = |value: &str| Config::from_vars(vars(&[("MAX_SIMULTANEOUS_EVENTS", value)]));
        assert_eq!(
            Config::from_vars(vars(&[]))
                .unwrap()
                .max_simultaneous_events,
            3
        );
        assert_eq!(limit("").unwrap().max_simultaneous_events, 3);
        assert_eq!(limit(" 1 ").unwrap().max_simultaneous_events, 1);
        assert_eq!(limit("10").unwrap().max_simultaneous_events, 10);
        for bad in ["0", "x", "-1", "1.5"] {
            let err = limit(bad).unwrap_err();
            assert!(
                matches!(err, ConfigError::Invalid(ref n, _) if n == "MAX_SIMULTANEOUS_EVENTS"),
                "{bad}: {err:?}"
            );
        }
    }

    // spec: MED-009, MED-011
    #[test]
    fn media_config_local_by_default_and_s3_on_demand() {
        let c = Config::from_vars(vars(&[])).unwrap();
        assert_eq!(
            c.media,
            MediaStorageConfig::Local {
                dir: PathBuf::from("./data/media")
            }
        );
        let c = Config::from_vars(vars(&[("MEDIA_LOCAL_DIR", "/var/lib/cartouche")])).unwrap();
        assert_eq!(
            c.media,
            MediaStorageConfig::Local {
                dir: PathBuf::from("/var/lib/cartouche")
            }
        );
        let c = Config::from_vars(vars(&[("MEDIA_STORAGE", "local")])).unwrap();
        assert!(matches!(c.media, MediaStorageConfig::Local { .. }));

        let s3 = [
            ("MEDIA_STORAGE", "s3"),
            ("MEDIA_S3_BUCKET", "cards"),
            ("MEDIA_S3_REGION", "eu-west-3"),
            ("MEDIA_S3_ACCESS_KEY_ID", "AKIAEXAMPLE"),
            ("MEDIA_S3_SECRET_ACCESS_KEY", "s3cr3t-value"),
            ("MEDIA_PUBLIC_BASE_URL", "https://cdn.example"),
        ];
        let c = Config::from_vars(vars(&s3)).unwrap();
        let MediaStorageConfig::S3 {
            bucket,
            region,
            endpoint,
            public_base_url,
            ..
        } = &c.media
        else {
            panic!("expected S3, got {:?}", c.media);
        };
        assert_eq!((bucket.as_str(), region.as_str()), ("cards", "eu-west-3"));
        assert_eq!(*endpoint, None);
        assert_eq!(public_base_url.as_str(), "https://cdn.example/");

        let mut with_endpoint = s3.to_vec();
        with_endpoint.push(("MEDIA_S3_ENDPOINT", "http://localhost:9000"));
        let c = Config::from_vars(vars(&with_endpoint)).unwrap();
        assert!(matches!(
            c.media,
            MediaStorageConfig::S3 { endpoint: Some(ref e), .. } if e.as_str() == "http://localhost:9000/"
        ));

        // The secret never shows up when the configuration is printed.
        let printed = format!("{c:?}");
        assert!(!printed.contains("s3cr3t-value"), "{printed}");
        assert!(printed.contains("***"));
    }

    // spec: MED-009, MED-011
    #[test]
    fn s3_requires_its_variables() {
        let full = [
            ("MEDIA_STORAGE", "s3"),
            ("MEDIA_S3_BUCKET", "cards"),
            ("MEDIA_S3_REGION", "eu-west-3"),
            ("MEDIA_S3_ACCESS_KEY_ID", "AKIAEXAMPLE"),
            ("MEDIA_S3_SECRET_ACCESS_KEY", "s3cr3t-value"),
            ("MEDIA_PUBLIC_BASE_URL", "https://cdn.example"),
        ];
        for (missing, _) in &full[1..] {
            let given: Vec<_> = full.iter().filter(|(n, _)| n != missing).copied().collect();
            assert_eq!(
                Config::from_vars(vars(&given)).unwrap_err(),
                ConfigError::Missing((*missing).to_string()),
                "without {missing}"
            );
        }
        // Blank counts as absent.
        let mut blank = full.to_vec();
        blank.push(("MEDIA_PUBLIC_BASE_URL", "  "));
        assert_eq!(
            Config::from_vars(vars(&blank)).unwrap_err(),
            ConfigError::Missing("MEDIA_PUBLIC_BASE_URL".into())
        );
    }

    // spec: MED-009
    #[test]
    fn invalid_media_values_are_errors() {
        for (name, value) in [("MEDIA_STORAGE", "ftp"), ("MEDIA_STORAGE", "S3 ")] {
            let err = Config::from_vars(vars(&[(name, value)])).unwrap_err();
            assert!(
                matches!(err, ConfigError::Invalid(ref n, _) if n == name),
                "{value}: {err:?}"
            );
        }
        let err = Config::from_vars(vars(&[
            ("MEDIA_STORAGE", "s3"),
            ("MEDIA_S3_BUCKET", "cards"),
            ("MEDIA_S3_REGION", "eu-west-3"),
            ("MEDIA_S3_ACCESS_KEY_ID", "k"),
            ("MEDIA_S3_SECRET_ACCESS_KEY", "s"),
            ("MEDIA_PUBLIC_BASE_URL", "not a url"),
        ]))
        .unwrap_err();
        assert!(matches!(err, ConfigError::Invalid(ref n, _) if n == "MEDIA_PUBLIC_BASE_URL"));
    }
}

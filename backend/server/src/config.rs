use std::collections::HashSet;
use std::net::SocketAddr;

use cartouche_domain::SignupMode;
use thiserror::Error;
use url::Url;

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
        let required = |name: &str| get(name).ok_or_else(|| ConfigError::Missing(name.to_string()));
        let optional = |name: &str| get(name).filter(|v| !v.trim().is_empty());
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
}

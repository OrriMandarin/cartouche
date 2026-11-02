use thiserror::Error;

use crate::config::{AppEnv, Config};

/// Issuer used by the test auth provider. Must never be accepted in production.
pub const TEST_ISSUER: &str = "cartouche-test-issuer";

/// Whether the `test-support` Cargo feature was compiled in.
pub const TEST_SUPPORT_COMPILED: bool = cfg!(feature = "test-support");

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum StartupError {
    #[error("refusing to start: AUTH_ISSUER is the test issuer while APP_ENV is production")]
    TestIssuerInProduction,
}

pub fn validate(config: &Config) -> Result<(), StartupError> {
    if config.app_env == AppEnv::Production && config.auth.issuer == TEST_ISSUER {
        return Err(StartupError::TestIssuerInProduction);
    }
    Ok(())
}

/// `/api/test/*` routes are mounted only if compiled in and not running in production.
pub fn test_routes_enabled(config: &Config) -> bool {
    TEST_SUPPORT_COMPILED && config.app_env != AppEnv::Production
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AppEnv, Config};
    use std::collections::HashMap;

    fn config(app_env: &str, issuer: &str) -> Config {
        let m: HashMap<&str, &str> = HashMap::from([
            ("APP_ENV", app_env),
            ("DATABASE_URL", "postgres://u:p@localhost/db"),
            ("AUTH_ISSUER", issuer),
            ("AUTH_JWKS_URL", "https://issuer.example.com/jwks.json"),
            ("PUBLIC_BASE_URL", "https://cartouche.example.com"),
        ]);
        Config::from_vars(|k| m.get(k).map(|v| (*v).to_string())).unwrap()
    }

    // spec: ACC-008
    #[test]
    fn test_issuer_in_production_refuses_to_start() {
        let c = config("production", TEST_ISSUER);
        assert_eq!(validate(&c), Err(StartupError::TestIssuerInProduction));
    }

    // spec: ACC-008
    #[test]
    fn missing_app_env_with_test_issuer_refuses_to_start() {
        let mut c = config("test", TEST_ISSUER);
        c.app_env = AppEnv::parse(None);
        assert_eq!(validate(&c), Err(StartupError::TestIssuerInProduction));
    }

    // spec: ACC-008
    #[test]
    fn test_issuer_in_test_env_is_allowed() {
        assert_eq!(validate(&config("test", TEST_ISSUER)), Ok(()));
        assert_eq!(validate(&config("development", TEST_ISSUER)), Ok(()));
    }

    #[test]
    fn real_issuer_in_production_is_allowed() {
        assert_eq!(
            validate(&config("production", "https://clerk.example.com")),
            Ok(())
        );
    }

    // spec: ACC-008
    #[test]
    fn test_routes_disabled_in_production_even_if_compiled() {
        assert!(!test_routes_enabled(&config(
            "production",
            "https://x.example.com"
        )));
    }

    #[test]
    fn test_routes_follow_feature_outside_production() {
        let expected = TEST_SUPPORT_COMPILED;
        assert_eq!(test_routes_enabled(&config("test", TEST_ISSUER)), expected);
        assert_eq!(
            test_routes_enabled(&config("development", TEST_ISSUER)),
            expected
        );
    }
}

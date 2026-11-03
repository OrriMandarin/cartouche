/** The API of the test stack (`compose.test.yml`). */
export const API_URL = "http://localhost:18080";
/** The web app of the test stack. */
export const WEB_URL = "http://localhost:13000";
/**
 * The instant (T0) the API clock is frozen at for the events tests: the `events` seed scenario
 * dates its events relative to it, and `TestApi.seedEvents` freezes the clock there.
 */
export const EVENTS_NOW = "2027-03-15T10:00:00.000Z";

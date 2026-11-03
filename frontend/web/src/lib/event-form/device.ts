export const DEVICE_COOKIE = "cartouche_device";
export const DEVICE_STORAGE_KEY = "cartouche.device";

/** 400 days (EVT-028). */
const COOKIE_MAX_AGE_SECONDS = 34_560_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DeviceEnv {
  storage?: Storage;
  /** `get` returns every cookie as `document.cookie` does; `set` receives one whole `name=value; attributes` string. */
  cookies?: { get(): string; set(value: string): void };
}

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // Access itself can throw when site data is blocked.
  }
}

function browserCookies(): DeviceEnv["cookies"] {
  if (typeof document === "undefined") return undefined;
  return {
    get: () => document.cookie,
    set: (value) => {
      document.cookie = value;
    },
  };
}

function attempt<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function readCookie(cookies: NonNullable<DeviceEnv["cookies"]>): string | undefined {
  const all = attempt(() => cookies.get()) ?? "";
  for (const part of all.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === DEVICE_COOKIE) return value.join("=");
  }
  return undefined;
}

function randomUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  // `randomUUID` only exists in a secure context; a phone on the http dev server has none.
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The identifier of this browser (EVT-015, EVT-028): the one in the local storage, else the one in the cookie,
 * else a new random one; written back to both. A store that throws or holds something else than an id is
 * skipped, so a private window still gets an id (the server's device limit is a light protection).
 */
export function getDeviceId(env: DeviceEnv = {}): string {
  const storage = env.storage ?? browserStorage();
  const cookies = env.cookies ?? browserCookies();
  const stored = storage ? attempt(() => storage.getItem(DEVICE_STORAGE_KEY)) : undefined;
  const cookie = cookies ? readCookie(cookies) : undefined;
  const id = [stored, cookie].find((candidate): candidate is string => !!candidate && UUID.test(candidate)) ?? randomUuid();
  // Written back at every visit: it fills the store that lacked it and renews the cookie's 400 days.
  if (storage) attempt(() => storage.setItem(DEVICE_STORAGE_KEY, id));
  if (cookies) {
    attempt(() => cookies.set(`${DEVICE_COOKIE}=${id}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`));
  }
  return id;
}

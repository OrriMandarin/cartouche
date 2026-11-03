import { afterEach, describe, expect, test, vi } from "vitest";
import { DEVICE_COOKIE, DEVICE_STORAGE_KEY, getDeviceId } from "./device";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KNOWN = "0198d000-0000-4000-8000-000000000042";

function fakeCookies(initial = "") {
  const writes: string[] = [];
  let jar = initial;
  return {
    writes,
    get: () => jar,
    set: (value: string) => {
      writes.push(value);
      jar = value.split(";")[0] ?? "";
    },
  };
}

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("getDeviceId", () => {
  test("EVT-015 EVT-028 the device id is created once and kept in both stores", () => {
    const cookies = fakeCookies();
    const first = getDeviceId({ storage: window.localStorage, cookies });
    expect(first).toMatch(UUID);
    expect(window.localStorage.getItem(DEVICE_STORAGE_KEY)).toBe(first);
    expect(cookies.writes).toHaveLength(1);
    expect(cookies.writes[0]).toBe(`${DEVICE_COOKIE}=${first}; path=/; max-age=34560000; SameSite=Lax`);
    expect(getDeviceId({ storage: window.localStorage, cookies })).toBe(first);
  });

  test("EVT-028 an id found in one store is copied to the other", () => {
    const fromCookie = fakeCookies(`other=1; ${DEVICE_COOKIE}=${KNOWN}; theme=dark`);
    expect(getDeviceId({ storage: window.localStorage, cookies: fromCookie })).toBe(KNOWN);
    expect(window.localStorage.getItem(DEVICE_STORAGE_KEY)).toBe(KNOWN);

    window.localStorage.clear();
    window.localStorage.setItem(DEVICE_STORAGE_KEY, KNOWN);
    const fromStorage = fakeCookies();
    expect(getDeviceId({ storage: window.localStorage, cookies: fromStorage })).toBe(KNOWN);
    expect(fromStorage.writes).toEqual([`${DEVICE_COOKIE}=${KNOWN}; path=/; max-age=34560000; SameSite=Lax`]);
  });

  test("EVT-028 the local storage is read before the cookie", () => {
    const other = "0198d000-0000-4000-8000-000000000043";
    window.localStorage.setItem(DEVICE_STORAGE_KEY, KNOWN);
    const cookies = fakeCookies(`${DEVICE_COOKIE}=${other}`);
    expect(getDeviceId({ storage: window.localStorage, cookies })).toBe(KNOWN);
    expect(cookies.writes[0]).toContain(`${DEVICE_COOKIE}=${KNOWN};`);
  });

  test("EVT-028 a stored value that is not an id is replaced", () => {
    window.localStorage.setItem(DEVICE_STORAGE_KEY, "not-an-id");
    const id = getDeviceId({ storage: window.localStorage, cookies: fakeCookies(`${DEVICE_COOKIE}=nope`) });
    expect(id).toMatch(UUID);
    expect(window.localStorage.getItem(DEVICE_STORAGE_KEY)).toBe(id);
  });

  test("EVT-028 storage failures still give an id", () => {
    const failing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    const cookies = {
      get: () => {
        throw new Error("denied");
      },
      set: () => {
        throw new Error("denied");
      },
    };
    expect(getDeviceId({ storage: failing, cookies })).toMatch(UUID);
  });

  test("EVT-028 the browser stores are used by default", () => {
    const id = getDeviceId();
    expect(id).toMatch(UUID);
    expect(window.localStorage.getItem(DEVICE_STORAGE_KEY)).toBe(id);
    expect(document.cookie).toContain(`${DEVICE_COOKIE}=${id}`);
  });
});

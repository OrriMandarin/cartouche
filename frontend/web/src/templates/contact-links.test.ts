import { describe, expect, test } from "vitest";
import { mailtoHref, telHref } from "./contact-links";

describe("mailtoHref", () => {
  test("PUB-021 a plain address becomes a mailto link", () => {
    expect(mailtoHref("eloise@example.com")).toBe("mailto:eloise@example.com");
  });

  test("PUB-021 characters that would change the link are percent-encoded", () => {
    expect(mailtoHref("a%b@example.com")).toBe("mailto:a%25b@example.com");
    expect(mailtoHref("a?subject=x@example.com")).toBe("mailto:a%3Fsubject=x@example.com");
    expect(mailtoHref("a#b@example.com")).toBe("mailto:a%23b@example.com");
    expect(mailtoHref("a&cc=evil@example.com")).toBe("mailto:a%26cc=evil@example.com");
    expect(mailtoHref("a,b@example.com")).toBe("mailto:a%2Cb@example.com");
  });

  test("PUB-021 whitespace and control characters are percent-encoded", () => {
    expect(mailtoHref("a b@example.com")).toBe("mailto:a%20b@example.com");
    expect(mailtoHref("a\tb\nc@example.com")).toBe("mailto:a%09b%0Ac@example.com");
    expect(mailtoHref("a\u0000b\u007f@example.com")).toBe("mailto:a%00b%7F@example.com");
  });

  test("PUB-021 an encoded address decodes back to the original", () => {
    const email = "o'brien+tag%?#&x y@example.com";
    expect(decodeURIComponent(mailtoHref(email).slice("mailto:".length))).toBe(email);
  });
});

describe("telHref", () => {
  test("PUB-021 an E.164 number becomes a tel link", () => {
    expect(telHref("+33612345678")).toBe("tel:+33612345678");
  });

  test("PUB-021 anything but digits and a leading plus is dropped", () => {
    expect(telHref(" +33 6 12-34.56(78) ")).toBe("tel:+33612345678");
    expect(telHref("0612345678;ext=1")).toBe("tel:06123456781");
  });
});

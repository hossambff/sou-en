import { describe, expect, it } from "vitest";
import { detectPlatform, isInAppBrowser } from "./platform";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const INSTAGRAM = `${IPHONE} Instagram 350.0.0.0`;

describe("detectPlatform", () => {
  it("spots iPhones and iPads (even when iPadOS pretends to be a Mac)", () => {
    expect(detectPlatform(IPHONE, 5)).toBe("ios");
    expect(detectPlatform(IPAD_AS_MAC, 5)).toBe("ios");
  });

  it("treats a real Mac as desktop", () => {
    expect(detectPlatform(IPAD_AS_MAC, 0)).toBe("desktop");
  });

  it("spots Android", () => {
    expect(detectPlatform(ANDROID, 5)).toBe("android");
  });
});

describe("isInAppBrowser", () => {
  it("flags Instagram's in-app browser", () => {
    expect(isInAppBrowser(INSTAGRAM)).toBe(true);
    expect(isInAppBrowser(IPHONE)).toBe(false);
  });
});

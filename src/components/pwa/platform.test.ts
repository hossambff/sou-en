import { describe, expect, it } from "vitest";
import { detectPlatform, iosBrowser, isInAppBrowser, pushAvailability } from "./platform";

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

describe("iosBrowser", () => {
  const CHROME_IOS =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1";
  const FIREFOX_IOS =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/142.0 Mobile/15E148 Safari/605.1.15";
  const GOOGLE_APP =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/380.0.0 Mobile/15E148 Safari/604.1";
  const WEB_VIEW = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

  it("tells Safari from other iPhone browsers", () => {
    expect(iosBrowser(IPHONE)).toBe("safari");
    expect(iosBrowser(IPAD_AS_MAC)).toBe("safari");
    expect(iosBrowser(CHROME_IOS)).toBe("other-browser");
    expect(iosBrowser(FIREFOX_IOS)).toBe("other-browser");
  });

  it("sends in-app browsers and app web views to Safari", () => {
    expect(iosBrowser(INSTAGRAM)).toBe("in-app");
    expect(iosBrowser(GOOGLE_APP)).toBe("in-app");
    expect(iosBrowser(WEB_VIEW)).toBe("in-app");
  });
});

describe("pushAvailability", () => {
  it("asks an iPhone in a browser tab to install first, even if the tab claims push support", () => {
    expect(pushAvailability("ios", false, true)).toBe("needs-install");
    expect(pushAvailability("ios", false, false)).toBe("needs-install");
  });

  it("goes by real support everywhere else", () => {
    expect(pushAvailability("ios", true, true)).toBe("ok");
    expect(pushAvailability("ios", true, false)).toBe("unsupported");
    expect(pushAvailability("android", false, true)).toBe("ok");
    expect(pushAvailability("desktop", false, false)).toBe("unsupported");
  });
});

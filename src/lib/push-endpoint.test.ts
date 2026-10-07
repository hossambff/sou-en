import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "./push-endpoint";

describe("isAllowedPushEndpoint", () => {
  it("accepts the real browser push services", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc:APA91b",
      "https://fcm.googleapis.com/wp/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAAA",
      "https://web.push.apple.com/QGuQyavXut",
      "https://api.push.apple.com/3/device/abc",
      "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
      "https://FCM.googleapis.com:443/fcm/send/abc",
    ]) {
      expect(isAllowedPushEndpoint(endpoint), endpoint).toBe(true);
    }
  });

  it("refuses anything else", () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/abc", // not https
      "https://evil.example.com/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.com/x",
      "https://push.apple.com/x", // the bare suffix isn't a push host
      "https://notapush.apple.com.evil.com/x",
      "https://fcm.googleapis.com:8443/fcm/send/abc", // odd port
      "https://user:pass@fcm.googleapis.com/fcm/send/abc",
      "https://localhost/push",
      "https://169.254.169.254/latest/meta-data",
      "not a url",
      "",
    ]) {
      expect(isAllowedPushEndpoint(endpoint), endpoint).toBe(false);
    }
  });
});

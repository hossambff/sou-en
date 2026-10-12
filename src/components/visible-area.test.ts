import { describe, expect, it } from "vitest";
import { visibleArea } from "./visible-area";

describe("visibleArea", () => {
  it("is null while nothing covers the page", () => {
    expect(visibleArea({ height: 797, offsetTop: 0, scale: 1 }, 797)).toBeNull();
  });

  it("follows the space above the keyboard, including iOS panning the page up", () => {
    expect(visibleArea({ height: 461.4, offsetTop: 0, scale: 1 }, 797)).toEqual({ top: 0, height: 461 });
    expect(visibleArea({ height: 461, offsetTop: 210.6, scale: 1 }, 797)).toEqual({ top: 211, height: 461 });
  });

  it("leaves a pinch-zoomed page alone", () => {
    expect(visibleArea({ height: 400, offsetTop: 120, scale: 2 }, 797)).toBeNull();
  });
});

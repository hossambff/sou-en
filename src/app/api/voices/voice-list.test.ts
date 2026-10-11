import { describe, expect, it } from "vitest";
import { parseVoices, snapSpeed, splitVoiceName } from "./voice-list";

const payload = {
  voices: [
    { voice_id: "hpp4J3VqNfWAUOO0d1Us", name: "Bella - Professional, Bright, Warm", category: "premade", labels: { gender: "female", accent: "american", age: "middle_aged" } },
    { voice_id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger - Laid-Back, Casual, Resonant", category: "premade", labels: { gender: "male", accent: "american", age: "middle_aged" } },
    { voice_id: "SAz9YHcvj6GT2YYXdXww", name: "River - Relaxed, Neutral, Informative", category: "premade", labels: { gender: "neutral" } },
    { voice_id: "cjVigY5qzO86Huf0OWal", name: "Eric - Smooth, Trustworthy", category: "premade", labels: { gender: "male", accent: "american" } },
    { voice_id: "LibraryVoice12345678", name: "Fancy - Library voice", category: "professional", labels: { gender: "male" } },
    { voice_id: "NMWQDQipWXm8HlCLKapi", name: "Coach Houssam", category: "professional", labels: { gender: "male", accent: "moroccan" } },
    { voice_id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger duplicate", category: "premade", labels: { gender: "male" } },
    { voice_id: "bad id!", name: "Broken", category: "premade", labels: { gender: "male" } },
    { name: "No id", labels: { gender: "male" } },
  ],
};

describe("parseVoices", () => {
  const voices = parseVoices(payload, "cjVigY5qzO86Huf0OWal");

  it("keeps the account's male and female voices (library voices too), Moroccan voices right after the default", () => {
    expect(voices.map((v) => v.name)).toEqual(["Eric", "Coach Houssam", "Fancy", "Roger", "Bella"]);
  });

  it("puts the default first, then male voices (the coach is a man)", () => {
    expect(voices[0]).toMatchObject({ id: "cjVigY5qzO86Huf0OWal", isDefault: true, gender: "male" });
    expect(voices.filter((v) => v.isDefault)).toHaveLength(1);
  });

  it("splits the marketing name and prettifies labels", () => {
    expect(voices.find((v) => v.name === "Roger")).toMatchObject({ tagline: "Laid-back, casual, resonant", accent: "American", age: "Middle aged" });
  });

  it("survives junk", () => {
    expect(parseVoices(null, null)).toEqual([]);
    expect(parseVoices({ voices: "nope" }, null)).toEqual([]);
  });
});

describe("splitVoiceName", () => {
  it("handles names without a tagline", () => {
    expect(splitVoiceName("Adam")).toEqual({ name: "Adam", tagline: null });
  });
});

describe("snapSpeed", () => {
  it("clamps to 0.8–1.1 in 0.05 steps", () => {
    expect(snapSpeed(0.97)).toBe(0.95);
    expect(snapSpeed(0.5)).toBe(0.8);
    expect(snapSpeed(2)).toBe(1.1);
    expect(snapSpeed(1.024)).toBe(1);
  });
});

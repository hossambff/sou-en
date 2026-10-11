// Request bodies for the placement and exam APIs (zod). Shared so the client builds exactly these.
import { z } from "zod";

const itemId = z.string().min(1).max(80);
const engine = z.enum(["azure", "basic", "transcript", "none"]);
const clipId = z.uuid().nullable().default(null);

// What she said is clipped, never rejected: one long answer (TV in the background, 45 s of Darija)
// must not make the whole test fail validation on every retry. The hard cap only stops absurd bodies.
const HARD_CAP = 20_000;
const clipped = (max: number) =>
  z
    .string()
    .max(HARD_CAP)
    .default("")
    .transform((text) => text.slice(0, max));
const clampedNumber = (min: number, max: number) => z.number().transform((value) => Math.min(max, Math.max(min, value)));
const sounds = z
  .array(z.string().max(HARD_CAP))
  .max(50)
  .default([])
  .transform((list) => list.map((sound) => sound.slice(0, 40)).slice(0, 5));

export const placementAnswerSchema = z.discriminatedUnion("section", [
  z.object({
    section: z.literal("listening"),
    itemId,
    choice: z.number().int().min(0).max(9).nullable(),
    replays: clampedNumber(0, 5).default(0),
  }),
  z.object({ section: z.literal("vocab"), itemId, said: clipped(500), typed: z.boolean().default(false) }),
  z.object({
    section: z.literal("repeat"),
    itemId,
    score: clampedNumber(0, 100).nullable(),
    engine,
    heard: clipped(500),
    sounds,
  }),
  z.object({
    section: z.literal("speaking"),
    itemId,
    transcript: clipped(4000),
    clipId,
    seconds: clampedNumber(0, 180).default(0),
  }),
]);

export const placementFinishSchema = z.object({
  /** Client-generated id for this attempt: "Try again" after a timeout can't save it twice */
  id: z.uuid(),
  answers: z.array(placementAnswerSchema).min(1).max(40),
  elapsedSeconds: clampedNumber(0, 7200).default(0),
});

const taskId = z.string().min(1).max(40);
const recording = {
  taskId,
  transcript: clipped(4000),
  clipId,
  seconds: clampedNumber(0, 180).default(0),
};

export const examAnswerSchema = z.discriminatedUnion("kind", [
  z.object({ taskId, kind: z.literal("say"), said: clipped(500), typed: z.boolean().default(false) }),
  z.object({
    taskId,
    kind: z.literal("repeat"),
    score: clampedNumber(0, 100).nullable(),
    engine,
    heard: clipped(500),
    sounds,
  }),
  z.object({ kind: z.literal("speak"), ...recording }),
  z.object({ kind: z.literal("roleplay"), ...recording }),
]);

export const examSubmitSchema = z.object({
  /** Client-generated id for this attempt */
  id: z.uuid(),
  unitId: z.string().min(1).max(40),
  seed: z.number().int().min(0).max(0x7fffffff),
  answers: z.array(examAnswerSchema).max(20),
  elapsedSeconds: clampedNumber(0, 7200).default(0),
});

// Request bodies for the placement and exam APIs (zod). Shared so the client builds exactly these.
import { z } from "zod";

const itemId = z.string().min(1).max(80);
const engine = z.enum(["azure", "basic", "transcript", "none"]);
const sounds = z.array(z.string().max(40)).max(5).default([]);
const clipId = z.uuid().nullable().default(null);

export const placementAnswerSchema = z.discriminatedUnion("section", [
  z.object({
    section: z.literal("listening"),
    itemId,
    choice: z.number().int().min(0).max(9).nullable(),
    replays: z.number().int().min(0).max(5).default(0),
  }),
  z.object({ section: z.literal("vocab"), itemId, said: z.string().max(500).default(""), typed: z.boolean().default(false) }),
  z.object({
    section: z.literal("repeat"),
    itemId,
    score: z.number().min(0).max(100).nullable(),
    engine,
    heard: z.string().max(500).default(""),
    sounds,
  }),
  z.object({
    section: z.literal("speaking"),
    itemId,
    transcript: z.string().max(4000).default(""),
    clipId,
    seconds: z.number().min(0).max(180).default(0),
  }),
]);

export const placementFinishSchema = z.object({
  /** Client-generated id for this attempt: "Try again" after a timeout can't save it twice */
  id: z.uuid(),
  answers: z.array(placementAnswerSchema).min(1).max(40),
  elapsedSeconds: z.number().min(0).max(7200).default(0),
});

const taskId = z.string().min(1).max(40);
const recording = {
  taskId,
  transcript: z.string().max(4000).default(""),
  clipId,
  seconds: z.number().min(0).max(180).default(0),
};

export const examAnswerSchema = z.discriminatedUnion("kind", [
  z.object({ taskId, kind: z.literal("say"), said: z.string().max(500).default(""), typed: z.boolean().default(false) }),
  z.object({
    taskId,
    kind: z.literal("repeat"),
    score: z.number().min(0).max(100).nullable(),
    engine,
    heard: z.string().max(500).default(""),
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
  elapsedSeconds: z.number().min(0).max(7200).default(0),
});

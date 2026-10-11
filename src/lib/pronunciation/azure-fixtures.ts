// Hand-written Azure Pronunciation Assessment responses (REST, short audio, format=detailed,
// Granularity=Phoneme, PhonemeAlphabet=IPA, EnableMiscue), shaped like the documented output. Test data only.

import type { AzureResponse } from "./analyze";

/** "I think it's three." with TH said as S/T: think 42 (θ 20), three 58 (θ 15), the rest fine. */
export const AZURE_TH_SLIPS: AzureResponse = {
  RecognitionStatus: "Success",
  DisplayText: "I sink it's tree.",
  NBest: [
    {
      Confidence: 0.86,
      Lexical: "i sink it's tree",
      Display: "I sink it's tree.",
      AccuracyScore: 71,
      FluencyScore: 88,
      CompletenessScore: 100,
      ProsodyScore: 74.5,
      PronScore: 76.2,
      Words: [
        { Word: "i", AccuracyScore: 98, ErrorType: "None", Phonemes: [{ Phoneme: "aɪ", AccuracyScore: 98 }] },
        {
          Word: "think",
          AccuracyScore: 42,
          ErrorType: "Mispronunciation",
          Phonemes: [
            { Phoneme: "θ", AccuracyScore: 20 },
            { Phoneme: "ɪ", AccuracyScore: 74 },
            { Phoneme: "ŋ", AccuracyScore: 90 },
            { Phoneme: "k", AccuracyScore: 95 },
          ],
        },
        {
          Word: "it's",
          AccuracyScore: 91,
          ErrorType: "None",
          Phonemes: [
            { Phoneme: "ɪ", AccuracyScore: 92 },
            { Phoneme: "t", AccuracyScore: 90 },
            { Phoneme: "s", AccuracyScore: 91 },
          ],
        },
        {
          Word: "three",
          AccuracyScore: 58,
          ErrorType: "None",
          Phonemes: [
            { Phoneme: "θ", AccuracyScore: 15 },
            { Phoneme: "ɹ", AccuracyScore: 80 },
            { Phoneme: "i", AccuracyScore: 79 },
          ],
        },
      ],
    },
  ],
};

/** "Please pass the paper." — "please" said as "blease" (p 30), "the" omitted, an extra "uh" inserted. SDK-style nesting. */
export const AZURE_P_OMISSION: AzureResponse = {
  RecognitionStatus: "Success",
  DisplayText: "Blease pass uh paper.",
  NBest: [
    {
      Lexical: "blease pass uh paper",
      Display: "Blease pass uh paper.",
      PronunciationAssessment: { AccuracyScore: 66, FluencyScore: 70, CompletenessScore: 75, PronScore: 68 },
      Words: [
        {
          Word: "please",
          PronunciationAssessment: { AccuracyScore: 55, ErrorType: "Mispronunciation" },
          Phonemes: [
            { Phoneme: "p", PronunciationAssessment: { AccuracyScore: 30 } },
            { Phoneme: "l", PronunciationAssessment: { AccuracyScore: 90 } },
            { Phoneme: "i", PronunciationAssessment: { AccuracyScore: 85 } },
            { Phoneme: "z", PronunciationAssessment: { AccuracyScore: 80 } },
          ],
        },
        {
          Word: "pass",
          PronunciationAssessment: { AccuracyScore: 72, ErrorType: "None" },
          Phonemes: [
            { Phoneme: "p", PronunciationAssessment: { AccuracyScore: 62 } },
            { Phoneme: "æ", PronunciationAssessment: { AccuracyScore: 80 } },
            { Phoneme: "s", PronunciationAssessment: { AccuracyScore: 85 } },
          ],
        },
        { Word: "uh", PronunciationAssessment: { AccuracyScore: 0, ErrorType: "Insertion" } },
        { Word: "the", PronunciationAssessment: { AccuracyScore: 0, ErrorType: "Omission" } },
        {
          Word: "paper",
          PronunciationAssessment: { AccuracyScore: 88, ErrorType: "None" },
          Phonemes: [
            { Phoneme: "p", PronunciationAssessment: { AccuracyScore: 86 } },
            { Phoneme: "eɪ", PronunciationAssessment: { AccuracyScore: 90 } },
            { Phoneme: "p", PronunciationAssessment: { AccuracyScore: 88 } },
            { Phoneme: "ɚ", PronunciationAssessment: { AccuracyScore: 87 } },
          ],
        },
      ],
    },
  ],
};

/** Silence or noise only. */
export const AZURE_NO_MATCH: AzureResponse = { RecognitionStatus: "NoMatch" };
export const AZURE_INITIAL_SILENCE: AzureResponse = { RecognitionStatus: "InitialSilenceTimeout" };

/** Everything omitted (she said something unrelated and Azure aligned nothing). */
export const AZURE_ALL_OMITTED: AzureResponse = {
  RecognitionStatus: "Success",
  DisplayText: "",
  NBest: [
    {
      Lexical: "",
      Display: "",
      AccuracyScore: 0,
      PronScore: 0,
      Words: [
        { Word: "ship", AccuracyScore: 0, ErrorType: "Omission" },
        { Word: "sheep", AccuracyScore: 0, ErrorType: "Omission" },
      ],
    },
  ],
};

/** "Sit in this seat" — short i too long in "sit" (ɪ 45) and "this" (ɪ 66), nice "seat". */
export const AZURE_SHORT_I: AzureResponse = {
  RecognitionStatus: "Success",
  DisplayText: "Seat in this seat.",
  NBest: [
    {
      Display: "Seat in this seat.",
      AccuracyScore: 74,
      FluencyScore: 90,
      CompletenessScore: 100,
      PronScore: 80,
      Words: [
        {
          Word: "sit",
          AccuracyScore: 61,
          ErrorType: "None",
          Phonemes: [
            { Phoneme: "s", AccuracyScore: 95 },
            { Phoneme: "ɪ", AccuracyScore: 45 },
            { Phoneme: "t", AccuracyScore: 90 },
          ],
        },
        { Word: "in", AccuracyScore: 90, ErrorType: "None", Phonemes: [{ Phoneme: "ɪ", AccuracyScore: 88 }, { Phoneme: "n", AccuracyScore: 95 }] },
        {
          Word: "this",
          AccuracyScore: 70,
          ErrorType: "None",
          Phonemes: [
            { Phoneme: "ð", AccuracyScore: 82 },
            { Phoneme: "ɪ", AccuracyScore: 66 },
            { Phoneme: "s", AccuracyScore: 92 },
          ],
        },
        {
          Word: "seat",
          AccuracyScore: 94,
          ErrorType: "None",
          Phonemes: [
            { Phoneme: "s", AccuracyScore: 95 },
            { Phoneme: "i", AccuracyScore: 93 },
            { Phoneme: "t", AccuracyScore: 94 },
          ],
        },
      ],
    },
  ],
};

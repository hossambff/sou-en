# Sou Coach

A voice-first English coach that speaks Darija. Built for Sou: 3-minute sessions, hands-free, zero guilt.
Product spec: [PRD.md](PRD.md).

## Stack
- **Next.js 16** (App Router) as an installable PWA. Node 22+ (`.nvmrc`).
- **Supabase Postgres**, accessed server-side with `pg`. RLS is on and there are no policies, so the public Data API can't read anything.
- **Better Auth**: email + password, sign-up limited to `ALLOWED_EMAILS`, Better Auth Infra `dash()` plugin.
- **Coach brain**: Claude via Vercel AI Gateway (AI SDK 7). It streams replies and uses tools to save words, log mistakes and remember facts.
- **Voice**: ElevenLabs Scribe (speech-to-text) and ElevenLabs TTS (Hossam's voice). Without those keys, the app falls back to the browser's built-in speech so you can still try it.
- **Spaced repetition**: FSRS (`ts-fsrs`) for the Word Garden.

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Fill in `.env.local` (see `.env.example`):
   - `DATABASE_URL`: Supabase → **Connect** → *Session pooler* URI
   - `ALLOWED_EMAILS`: Sou's and Hossam's emails
   - `AI_GATEWAY_API_KEY`: from the Vercel dashboard → AI Gateway
   - `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`: optional, but needed for real Darija voice
3. Create the tables:
   ```bash
   npm run db:migrate
   ```
4. Start the dev server, then open http://localhost:3000:
   ```bash
   npm run dev
   ```

## How a session works
```
tap orb → mic + audio unlocked → POST /api/session
   ↓
/api/coach (event: start) → Claude streams text → split into sentences → /api/tts per sentence → plays in order
   ↓
listen (voice-activity detection: stops after ~1.5 s of silence; whisper mode is more sensitive)
   → /api/stt → her text → /api/coach → …
   ↓
time up → coach wraps up → +5 min or Finish → /api/session/:id/end (summary + golden fixes) → /recap/:id
```
The **Baby!** button cancels everything in flight. **I'm back** resumes with a "welcome back" from the coach.

## Key files
- `src/lib/coach-prompt.ts`: Hossam's persona, the Darija → English ratio per month, behaviour rules
- `src/app/api/coach/route.ts`: the conversation turn and the coach's tools
- `src/lib/voice/`: `Speaker` (streamed TTS, iOS audio unlock, browser fallback) and `Listener` (VAD, recording, STT)
- `src/lib/progress.ts`: points, levels, journey cities
- `db/app-schema.sql`: app tables

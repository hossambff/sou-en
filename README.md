# Sou Coach

A voice-first English coach that speaks Darija, built for Sou: 3-minute sessions, hands-free, zero guilt.
Product spec: [PRD.md](PRD.md).

## What's inside
| Area | Features |
|---|---|
| **Talk to Hossam** | Live voice conversation. Hossam speaks Moroccan Darija + English, and the Darija fades month by month. Includes free talk, role-plays (pediatrician, pharmacy, vaccine call, job interview…), Story time, and Fix my mistakes. There's a Baby! pause button, Whisper and Night modes, voice commands ("repeat", "slower", "بشوية", "stop"), and a recap with up to 3 golden fixes. |
| **Drills** | Shadow Me (repeat after Hossam, with word-by-word scoring) and Say It Back (spoken spaced repetition with FSRS). |
| **Word Garden** | Every word Hossam teaches gets planted and grows as she says it, with search, filters, tap-to-hear and delete. |
| **How do I say…?** | Say or type something in Darija or French and get natural English back, read aloud, with one tap to save it. |
| **Today's plan** | 1–3 bites picked from her time, due words, recent mistakes, the time of day and what she already did. |
| **Monthly check-up** | 3 recorded questions, a CEFR estimate, rubric bars, and before/after playback against day 1. |
| **Progress** | Weekly minutes chart, the six-city journey, and a "Grow Together" timeline of the baby's milestones next to hers. |
| **Bedtime story** | A tiny English story starring the baby, read along sentence by sentence in night mode. |
| **Cheer Squad** | The husband's view: her wins only (never mistakes or transcripts), and voice cheers that play before her next session. |
| **Reminders** | One gentle web-push nudge a day at her chosen hour. Never at night, and never if she already practiced. |
| **Settings** | Voice picker with preview, speaking speed, default session length, reminder hour, install guide. |

## Stack
- **Next.js 16** (App Router) as an installable PWA (manifest, service worker, iOS install guide). Node 22+ (`.nvmrc`).
- **Postgres on Supabase**, accessed server-side with `pg`. Every table has row-level security on and no policies, so Supabase's public Data API can't read anything.
- **Better Auth**: email + password, invite-only (`ALLOWED_EMAILS`, fails closed), roles (learner / cheerleader), and the Better Auth Infra `dash()` plugin.
- **Claude** (`@anthropic-ai/sdk`, model `claude-opus-5-5`) with server-side refusal fallback and a daily call cap.
- **ElevenLabs**: Scribe for speech-to-text and TTS for Hossam's voice. Reusable phrases are cached in Postgres. If the server voice is unavailable, the app automatically falls back to the phone's built-in voice and speech recognition.

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Fill in `.env.local` (see `.env.example` for every variable):
   - `DATABASE_URL`: Supabase → **Connect** → *Session pooler* URI
   - `ANTHROPIC_API_KEY`
   - `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`
   - `ALLOWED_EMAILS` and `LEARNER_EMAIL`
   - `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`
   - VAPID keys and `CRON_SECRET`
3. Create or upgrade the tables (Better Auth tables, then `db/*.sql` in name order; idempotent):
   ```bash
   npm run db:migrate
   ```
4. Start the dev server:
   ```bash
   npm run dev
   ```

## Checks
```bash
npm run typecheck
```
```bash
npm test
```
```bash
npx eslint src
```
Set `TEST_DATABASE_URL` to also run the Postgres-backed tests.

## Reminders schedule
`/api/cron/reminders` must run **hourly**: it sends reminders, closes sessions she left without tapping Finish (and writes their recap), and cleans up audio. Vercel Hobby only allows daily crons, so `vercel.json` keeps a daily fallback. Register the hourly job in Supabase (pg_cron + pg_net) once after deploying:
```bash
APP_URL=https://your-app.vercel.app npm run schedule:reminders
```

## Key files
- `src/lib/coach-prompt.ts`: Hossam's persona, the Darija → English ratio per month, activity scripts
- `src/app/api/coach/route.ts`: one conversation turn (streaming, tools, daily cap, retries)
- `src/lib/voice/`: `Speaker` (streamed TTS, iOS unlock, Web Audio volume, phone-voice fallback) and `Listener` (voice activity detection, recording, STT, typed failures)
- `src/lib/plan.ts`, `src/lib/milestones.ts`, `src/lib/progress.ts`: daily plan, Grow Together timeline, points and levels
- `db/*.sql`: schema, applied in name order

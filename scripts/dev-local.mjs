// Try Sou Coach on this computer without Supabase: starts a built-in test Postgres (PGlite),
// creates the tables, and runs the app at http://localhost:3001.
//   npm run dev:local
// Test accounts (sign up with any password, 8+ characters):
//   sou@test.local     → the learner (Sou)
//   hossam@test.local  → the Cheer Squad
// Data lives in .local-db/ (delete the folder to start fresh).
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const DB_PORT = 5433;
const APP_PORT = 3001;
const DATABASE_URL = `postgres://postgres:postgres@localhost:${DB_PORT}/postgres`;

const env = {
  ...process.env,
  DATABASE_URL,
  BETTER_AUTH_URL: `http://localhost:${APP_PORT}`,
  ALLOWED_EMAILS: "sou@test.local,hossam@test.local",
  LEARNER_EMAIL: "sou@test.local",
};

const children = [];
const run = (command, args, options = {}) => {
  const child = spawn(command, args, { cwd: root, env, stdio: "inherit", ...options });
  children.push(child);
  return child;
};
const stopAll = () => children.forEach((child) => child.killed || child.kill("SIGTERM"));
process.on("SIGINT", () => (stopAll(), process.exit(0)));
process.on("SIGTERM", () => (stopAll(), process.exit(0)));

const portOpen = (port) =>
  new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" }, () => (socket.end(), resolve(true)));
    socket.on("error", () => resolve(false));
  });

async function main() {
  if (!(await portOpen(DB_PORT))) {
    console.log("▶ Starting the local test database (.local-db/)…");
    run(process.execPath, [
      "node_modules/@electric-sql/pglite-socket/dist/scripts/server.js",
      "--db=./.local-db",
      `--port=${DB_PORT}`,
      "--max-connections=20",
    ]);
    for (let i = 0; i < 60 && !(await portOpen(DB_PORT)); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await portOpen(DB_PORT))) throw new Error("The local database didn't start");
  } else {
    console.log(`▶ Using the database already running on port ${DB_PORT}`);
  }

  console.log("▶ Creating tables…");
  const migrate = run("npx", ["tsx", "--env-file=.env.local", "scripts/migrate.ts"]);
  const code = await new Promise((resolve) => migrate.on("exit", resolve));
  if (code !== 0) throw new Error("Migration failed");

  console.log(`\n✅ Open http://localhost:${APP_PORT} in Chrome or Safari`);
  console.log("   Sign up as sou@test.local (Sou) or hossam@test.local (Cheer Squad), any password (8+ characters)\n");
  const app = run("npx", ["next", "dev", "--port", String(APP_PORT)]);
  app.on("exit", (exitCode) => (stopAll(), process.exit(exitCode ?? 0)));
}

main().catch((error) => {
  console.error(error.message ?? error);
  stopAll();
  process.exit(1);
});

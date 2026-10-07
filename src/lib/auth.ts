import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { dash } from "@better-auth/infra";
import { pool } from "./pool";

const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export const auth = betterAuth({
  database: pool,
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  session: { expiresIn: 60 * 60 * 24 * 90 }, // stay signed in for 90 days — no re-login at 3 am
  user: {
    // This is a family app: only invited emails may sign up.
    validateUserInfo: ({ user, source }) => {
      if (source.action !== "create-user" || allowedEmails.length === 0) return;
      if (!allowedEmails.includes(String(user.email ?? "").toLowerCase())) {
        return { error: "not_invited", errorDescription: "This email isn't on the family list." };
      }
    },
  },
  plugins: [dash(), nextCookies()],
});

export type Session = typeof auth.$Infer.Session;

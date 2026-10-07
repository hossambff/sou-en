import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { dash } from "@better-auth/infra";
import { pool } from "./pool";
import { sendResetPasswordEmail } from "./email";

const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

// Password-reset emails go through Better Auth Infra. Only switch them on once the
// Infra API key and the "reset-password" template work (EMAIL_ENABLED=1).
const emailEnabled = process.env.EMAIL_ENABLED === "1";

export const auth = betterAuth({
  database: pool,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    ...(emailEnabled
      ? { sendResetPassword: sendResetPasswordEmail, resetPasswordTokenExpiresIn: 60 * 60, revokeSessionsOnPasswordReset: true }
      : {}),
  },
  session: { expiresIn: 60 * 60 * 24 * 90 }, // stay signed in for 90 days — no re-login at 3 am
  user: {
    // Family app: only invited emails may sign up. Fails closed — an empty list lets nobody in.
    validateUserInfo: ({ user, source }) => {
      if (source.action !== "create-user") return;
      if (!allowedEmails.includes(String(user.email ?? "").toLowerCase())) {
        return { error: "not_invited", errorDescription: "This email isn't on the family list." };
      }
    },
  },
  plugins: [dash(), nextCookies()],
});

export type Session = typeof auth.$Infer.Session;

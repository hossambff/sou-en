// Transactional email through Better Auth Infra (uses BETTER_AUTH_API_KEY and the dashboard's templates).
// No "server-only" import on purpose: src/lib/auth.ts imports this, and scripts/migrate.ts imports auth.ts
// outside of Next.js. Nothing in the browser bundle imports it.
import { sendEmail } from "@better-auth/infra";

type ResetEmail = { user: { email: string; name?: string | null }; url: string; token: string };

/**
 * Better Auth `emailAndPassword.sendResetPassword` handler. Throws when the email can't be sent, so the
 * "Forgot password?" form shows an error instead of promising a link that never arrives.
 */
export async function sendResetPasswordEmail({ user, url }: ResetEmail) {
  const result = await sendEmail({
    template: "reset-password",
    to: user.email,
    variables: {
      resetLink: url,
      userEmail: user.email,
      userName: user.name || undefined,
      appName: "Sou Coach",
      expirationMinutes: "60",
    },
  });
  if (!result.success) {
    console.error("Password reset email failed:", result.error);
    throw new Error("We couldn't send the reset email right now.");
  }
}

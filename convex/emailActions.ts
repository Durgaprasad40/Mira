"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";

// =============================================================================
// Email Actions - runs in Node.js runtime for external API calls
// =============================================================================

// Supported email providers
type EmailProvider = "resend" | "sendgrid";

/**
 * Detect which email provider is configured based on env vars.
 */
function getEmailProvider(): { provider: EmailProvider; apiKey: string } | null {
  const resendKey = process.env.RESEND_API_KEY;
  const sendgridKey = process.env.SENDGRID_API_KEY;

  if (resendKey) {
    return { provider: "resend", apiKey: resendKey };
  }
  if (sendgridKey) {
    return { provider: "sendgrid", apiKey: sendgridKey };
  }
  return null;
}

/**
 * Get the app base URL for verification links.
 */
function getAppBaseUrl(): string {
  // Use configured URL or fall back to localhost for dev
  return process.env.APP_BASE_URL || "http://localhost:8081";
}

/**
 * Get the "from" email address.
 */
function getFromEmail(): string {
  return process.env.EMAIL_FROM || "noreply@mira.app";
}

/**
 * Build the email verification link.
 */
function buildVerificationLink(userId: string, token: string): string {
  const baseUrl = getAppBaseUrl();
  // Deep link format for mobile app
  return `${baseUrl}/verify-email?userId=${userId}&token=${token}`;
}

/**
 * Send email via Resend API.
 */
async function sendViaResend(
  apiKey: string,
  to: string,
  subject: string,
  html: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: getFromEmail(),
        to: [to],
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("[Email] Resend API error:", response.status);
      return { success: false, error: "Email delivery failed" };
    }

    return { success: true };
  } catch (err) {
    console.error("[Email] Resend request failed");
    return { success: false, error: "Email service unavailable" };
  }
}

/**
 * Send email via SendGrid API.
 */
async function sendViaSendGrid(
  apiKey: string,
  to: string,
  subject: string,
  html: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: getFromEmail() },
        subject,
        content: [{ type: "text/html", value: html }],
      }),
    });

    // SendGrid returns 202 for success
    if (response.status !== 202 && !response.ok) {
      console.error("[Email] SendGrid API error:", response.status);
      return { success: false, error: "Email delivery failed" };
    }

    return { success: true };
  } catch (err) {
    console.error("[Email] SendGrid request failed");
    return { success: false, error: "Email service unavailable" };
  }
}

/**
 * Send verification email action.
 * Called from mutations after token generation.
 */
export const sendVerificationEmail = action({
  args: {
    userId: v.string(),
    email: v.string(),
    token: v.string(),
    userName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    const { userId, email, token, userName } = args;

    // Check if email provider is configured
    const providerConfig = getEmailProvider();

    if (!providerConfig) {
      // No provider configured - log for dev, return success to not block signup
      if (process.env.DEBUG_AUTH === "true") {
        console.log(`[Email-DEV] Verification email for ${email} (no provider configured)`);
      }
      return { success: true, error: "No email provider configured" };
    }

    // Build verification link
    const verificationLink = buildVerificationLink(userId, token);

    // Build email content
    const subject = "Verify your Mira account";
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #333; font-size: 24px; margin-bottom: 20px;">Welcome to Mira${userName ? `, ${userName}` : ""}!</h1>
        <p style="color: #555; font-size: 16px; line-height: 1.5;">
          Please verify your email address to complete your registration.
        </p>
        <div style="margin: 30px 0;">
          <a href="${verificationLink}"
             style="background-color: #FF6B6B; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
            Verify Email
          </a>
        </div>
        <p style="color: #888; font-size: 14px;">
          Or copy and paste this link into your browser:
        </p>
        <p style="color: #666; font-size: 14px; word-break: break-all;">
          ${verificationLink}
        </p>
        <p style="color: #888; font-size: 12px; margin-top: 30px;">
          This link expires in 24 hours. If you didn't create an account, you can ignore this email.
        </p>
      </div>
    `;

    // Send via configured provider
    const { provider, apiKey } = providerConfig;

    if (provider === "resend") {
      return await sendViaResend(apiKey, email, subject, html);
    } else {
      return await sendViaSendGrid(apiKey, email, subject, html);
    }
  },
});

export type EnforcementLevel =
  | "none"
  | "gentle_reminder"
  | "reduced_reach"
  | "security_only";

export type VerificationStatus =
  | "unverified"
  | "pending_verification"
  | "verified";

interface EnforcementInput {
  createdAt: number;
  verificationStatus: VerificationStatus;
  isDemoMode?: boolean;
}

export function computeEnforcementLevel(
  input: EnforcementInput
): EnforcementLevel {
  if (input.isDemoMode) return "none";
  if (input.verificationStatus === "verified") return "none";

  const accountAgeDays =
    (Date.now() - input.createdAt) / (24 * 60 * 60 * 1000);

  if (accountAgeDays < 3) {
    return "gentle_reminder";
  }

  if (accountAgeDays < 6) {
    return input.verificationStatus === "pending_verification"
      ? "gentle_reminder"
      : "reduced_reach";
  }

  // Day 7+
  return input.verificationStatus === "pending_verification"
    ? "reduced_reach"
    : "security_only";
}

interface EnforcementMessage {
  title: string;
  body: string;
  ctaLabel: string;
}

export function getEnforcementMessage(
  level: EnforcementLevel
): EnforcementMessage | null {
  switch (level) {
    case "gentle_reminder":
      return {
        title: "Build trust on your profile",
        body: "Verified profiles get up to 3x more matches. Verify now to stand out.",
        ctaLabel: "Verify Now",
      };
    case "reduced_reach":
      return {
        title: "Your reach is limited",
        body: "Verify your identity to unlock full reach and be seen by more people.",
        ctaLabel: "Verify to Unlock",
      };
    case "security_only":
      return {
        title: "Verification Required",
        body: "Please verify your identity to continue using Mira.",
        ctaLabel: "Verify Now",
      };
    default:
      return null;
  }
}

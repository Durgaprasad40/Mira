export type VerificationDisplayLabel = 'Verified' | 'Verification pending' | 'Not verified';
export type VerificationDisplayTone = 'verified' | 'pending' | 'unverified';

export function getVerificationDisplay(input: {
  isVerified?: boolean | null;
  verificationStatus?: string | null;
}): {
  label: VerificationDisplayLabel;
  tone: VerificationDisplayTone;
} {
  if (input.verificationStatus === 'verified' || input.isVerified === true) {
    return { label: 'Verified', tone: 'verified' };
  }

  if (
    input.verificationStatus === 'pending_verification' ||
    input.verificationStatus === 'pending_auto' ||
    input.verificationStatus === 'pending_manual'
  ) {
    return { label: 'Verification pending', tone: 'pending' };
  }

  return { label: 'Not verified', tone: 'unverified' };
}

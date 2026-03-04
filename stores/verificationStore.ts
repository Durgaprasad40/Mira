/**
 * verificationStore — In-memory store for user verification statuses.
 *
 * STORAGE POLICY ENFORCEMENT:
 * NO local persistence. Verification statuses are user information.
 * All verification states must be rehydrated from Convex on app boot.
 * Convex is the ONLY source of truth.
 *
 * Manages Face Verification and KYC Verification states:
 * - Face: not_verified | pending | verified
 * - KYC: not_started | pending | verified
 */
import { create } from 'zustand';

export type FaceVerificationStatus = 'not_verified' | 'pending' | 'verified';
export type KycVerificationStatus = 'not_started' | 'pending' | 'verified';

interface VerificationState {
  // Face verification
  faceStatus: FaceVerificationStatus;
  faceVerifiedAt: number | null;

  // KYC verification
  kycStatus: KycVerificationStatus;
  kycVerifiedAt: number | null;

  // Hydration (always true - no AsyncStorage)
  _hasHydrated: boolean;

  // Actions
  setHasHydrated: (state: boolean) => void;

  // Face verification actions
  startFaceVerification: () => void;
  completeFaceVerification: () => void;
  failFaceVerification: () => void;

  // KYC verification actions
  startKycVerification: () => void;
  completeKycVerification: () => void;
  failKycVerification: () => void;

  // Reset (for testing)
  resetVerification: () => void;
}

export const useVerificationStore = create<VerificationState>()((set) => ({
  faceStatus: 'not_verified',
  faceVerifiedAt: null,
  kycStatus: 'not_started',
  kycVerifiedAt: null,
  _hasHydrated: true,

  setHasHydrated: (state) => set({ _hasHydrated: true }),

  // Face verification actions
  startFaceVerification: () =>
    set({ faceStatus: 'pending' }),

  completeFaceVerification: () =>
    set({
      faceStatus: 'verified',
      faceVerifiedAt: Date.now(),
    }),

  failFaceVerification: () =>
    set({ faceStatus: 'not_verified' }),

  // KYC verification actions
  startKycVerification: () =>
    set({ kycStatus: 'pending' }),

  completeKycVerification: () =>
    set({
      kycStatus: 'verified',
      kycVerifiedAt: Date.now(),
    }),

  failKycVerification: () =>
    set({ kycStatus: 'not_started' }),

  // Reset
  resetVerification: () =>
    set({
      faceStatus: 'not_verified',
      faceVerifiedAt: null,
      kycStatus: 'not_started',
      kycVerifiedAt: null,
    }),
}));

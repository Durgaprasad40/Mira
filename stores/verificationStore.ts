/**
 * verificationStore — Persisted store for user verification statuses.
 *
 * Manages Face Verification and KYC Verification states:
 * - Face: not_verified | pending | verified
 * - KYC: not_started | pending | verified
 *
 * Also tracks if user has a paid subscription (for KYC gating).
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type FaceVerificationStatus = 'not_verified' | 'pending' | 'verified';
export type KycVerificationStatus = 'not_started' | 'pending' | 'verified';

interface VerificationState {
  // Face verification
  faceStatus: FaceVerificationStatus;
  faceVerifiedAt: number | null;

  // KYC verification
  kycStatus: KycVerificationStatus;
  kycVerifiedAt: number | null;

  // Hydration
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

export const useVerificationStore = create<VerificationState>()(
  persist(
    (set) => ({
      faceStatus: 'not_verified',
      faceVerifiedAt: null,
      kycStatus: 'not_started',
      kycVerifiedAt: null,
      _hasHydrated: false,

      setHasHydrated: (state) => set({ _hasHydrated: state }),

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
    }),
    {
      name: 'mira-verification-store',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
        if (__DEV__) {
          console.log('[verificationStore] Hydrated', {
            faceStatus: state?.faceStatus,
            kycStatus: state?.kycStatus,
          });
        }
      },
      partialize: (state) => ({
        faceStatus: state.faceStatus,
        faceVerifiedAt: state.faceVerifiedAt,
        kycStatus: state.kycStatus,
        kycVerifiedAt: state.kycVerifiedAt,
      }),
    }
  )
);

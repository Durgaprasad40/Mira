/**
 * Phase 2 Onboarding - Step 1: Terms & Consent
 *
 * - User must agree to Private Mode rules
 * - Imports Phase-1 profile data from Convex (or demoStore in demo mode)
 * - Proceeds to profile setup (Step 2)
 *
 * 18+ check already done by PrivateConsentGate in _layout.tsx
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "convex/react";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "@/convex/_generated/api";
import { INCOGNITO_COLORS } from "@/lib/constants";
import { usePrivateProfileStore, Phase1ProfileData } from "@/stores/privateProfileStore";
import { useAuthStore } from "@/stores/authStore";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { isDemoMode } from "@/hooks/useConvex";
import { getDemoCurrentUser } from "@/lib/demoData";
import { useDemoStore, photosToSlotsStable } from "@/stores/demoStore";
import { PhotoSlots9, createEmptyPhotoSlots } from "@/types";

// Persistent directory for Phase-1 photos imported into Phase-2
const PHASE1_PHOTOS_DIR = "mira/phase1Photos/";

/**
 * Check if a URI is a valid persistent photo URI.
 * Only accepts local file:// URIs that are NOT in cache directories.
 */
function isValidPhotoUri(uri: string | null | undefined): boolean {
  if (!uri || typeof uri !== 'string' || uri.length === 0) return false;
  if (!uri.startsWith('file://')) return false;
  if (uri.includes('/cache/') || uri.includes('/Cache/') || uri.includes('ImageManipulator')) return false;
  if (uri.includes('unsplash.com')) return false;
  return true;
}

/**
 * Validate and filter PhotoSlots9 - keeps slot positions, invalid URIs become null.
 */
function validatePhotoSlots(slots: PhotoSlots9): PhotoSlots9 {
  const result: PhotoSlots9 = createEmptyPhotoSlots();
  for (let i = 0; i < 9; i++) {
    const uri = slots[i];
    result[i] = isValidPhotoUri(uri) ? uri : null;
  }
  return result;
}

/**
 * Filter out stale cache URIs that no longer exist on disk.
 * Cache files (ImageManipulator, etc.) are deleted after app relaunch.
 * Returns only URIs that actually exist or are remote (https).
 */
async function filterStaleCacheUris(uris: string[]): Promise<{ kept: string[]; droppedMissing: number }> {
  const kept: string[] = [];
  let droppedMissing = 0;

  for (const uri of uris) {
    if (!uri || typeof uri !== "string") continue;

    // Remote URLs are always valid (no local file check needed)
    if (uri.startsWith("http://") || uri.startsWith("https://")) {
      kept.push(uri);
      continue;
    }

    // content:// and ph:// are system-managed, assume valid
    if (uri.startsWith("content://") || uri.startsWith("ph://")) {
      kept.push(uri);
      continue;
    }

    // For file:// URIs, check if the file actually exists
    if (uri.startsWith("file://")) {
      try {
        const info = await FileSystem.getInfoAsync(uri);
        if (info.exists) {
          kept.push(uri);
        } else {
          droppedMissing++;
          if (__DEV__) console.log("[FilterStale] Dropped missing:", uri.slice(-60));
        }
      } catch (err) {
        droppedMissing++;
        if (__DEV__) console.log("[FilterStale] Check error:", uri.slice(-60), err);
      }
      continue;
    }

    // Unknown scheme, keep it
    kept.push(uri);
  }

  return { kept, droppedMissing };
}

/**
 * Copy cache file:// URIs to persistent storage so they survive app restarts.
 * - Cache URIs (ImageManipulator, etc.) are volatile and disappear on relaunch
 * - We copy them to FileSystem.documentDirectory which is persistent
 */
async function persistPhotoUris(uris: string[]): Promise<string[]> {
  const results: string[] = [];
  const destDir = FileSystem.documentDirectory + PHASE1_PHOTOS_DIR;

  // Ensure destination directory exists (ignore errors if already exists)
  await FileSystem.makeDirectoryAsync(destDir, { intermediates: true }).catch(() => {});
  if (__DEV__) console.log("[PersistPhotos] destDir:", destDir);

  for (const uri of uris) {
    // CRITICAL: Keep fullUri as the UNMODIFIED original - never slice it
    const fullUri = uri;
    // short is ONLY for logging - NEVER use it for file operations
    const short = typeof fullUri === "string" ? fullUri.slice(-70) : String(fullUri);

    // Skip empty/invalid
    if (!fullUri || typeof fullUri !== "string") continue;

    // DEV assertion: fullUri must start with valid prefix
    if (__DEV__) {
      const isValidPrefix = fullUri.startsWith("file://") || fullUri.startsWith("http") || fullUri.startsWith("content://");
      if (!isValidPrefix) {
        console.error("[PersistPhotos] INVALID URI PREFIX:", fullUri);
      }
    }

    // http/https/content/ph URIs don't need copying - they're either remote or system-managed
    if (fullUri.startsWith("http") || fullUri.startsWith("content://") || fullUri.startsWith("ph://")) {
      results.push(fullUri);
      continue;
    }

    // Check if it's a cache URI that needs copying
    const isCache = fullUri.startsWith("file://") &&
      (fullUri.includes("/cache/") || fullUri.includes("/Cache/") || fullUri.includes("ImageManipulator"));

    if (!isCache) {
      // Already persistent or unknown format, keep as-is
      results.push(fullUri);
      continue;
    }

    // Copy cache file to persistent storage
    try {
      // Verify source exists - MUST use fullUri
      if (__DEV__) console.log("[PersistPhotos] Checking source:", fullUri);
      const sourceInfo = await FileSystem.getInfoAsync(fullUri);
      if (!sourceInfo.exists) {
        if (__DEV__) console.warn("[PersistPhotos] Source missing (short):", short);
        // Still add to results so fallback works
        results.push(fullUri);
        continue;
      }

      // Generate filename and destination path
      const filename = fullUri.split("/").pop() || `p1_${Date.now()}.jpg`;
      const dest = destDir + filename;

      // Check if already copied
      const destInfo = await FileSystem.getInfoAsync(dest);
      if (destInfo.exists) {
        if (__DEV__) console.log("[PersistPhotos] Already exists:", dest);
        results.push(dest);
        continue;
      }

      // Copy to persistent storage - MUST use fullUri
      await FileSystem.copyAsync({ from: fullUri, to: dest });

      // Verify copy succeeded
      const check = await FileSystem.getInfoAsync(dest);
      if (__DEV__) {
        console.log("[PersistPhotos] Copied:", { from: short, dest, exists: check.exists });
      }

      if (check.exists) {
        results.push(dest);
      } else {
        results.push(fullUri);
      }
    } catch (err) {
      if (__DEV__) console.error("[PersistPhotos] Error (short):", short, err);
      results.push(fullUri);
    }
  }

  if (__DEV__) {
    console.log("[PersistPhotos] Done:", { input: uris.length, output: results.length });
    results.forEach((r, i) => console.log(`[PersistPhotos] [${i}]:`, r));
  }

  return results;
}

const C = INCOGNITO_COLORS;

export default function Phase2OnboardingTerms() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Terms checkboxes
  const [rulesChecked, setRulesChecked] = useState(false);
  const [screenshotChecked, setScreenshotChecked] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const setAcceptedTermsAt = usePrivateProfileStore((s) => s.setAcceptedTermsAt);
  const importPhase1Data = usePrivateProfileStore((s) => s.importPhase1Data);

  // Get userId for Convex query
  const userId = useAuthStore((s) => s.userId);

  // Query Phase-1 profile from Convex (the real source of truth after onboarding)
  const convexUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  // For demo mode, get demo user data
  const demoUser = isDemoMode ? getDemoCurrentUser() : null;

  // Extract photos from user object (handles different formats)
  const extractPhotos = (user: any): { url: string }[] => {
    if (!user) return [];

    // Try user.photos first (most common)
    let rawPhotos = user.photos;

    // Fallback to user.photoUrls if photos doesn't exist
    if (!rawPhotos?.length && user.photoUrls?.length) {
      rawPhotos = user.photoUrls;
    }

    if (!rawPhotos?.length) return [];

    return rawPhotos
      .map((p: any) => {
        // Handle string URLs directly
        if (typeof p === 'string' && p.length > 0) {
          return { url: p };
        }
        // Handle { url: string } objects
        if (p?.url && typeof p.url === 'string' && p.url.length > 0) {
          return { url: p.url };
        }
        // Handle { uri: string } objects
        if (p?.uri && typeof p.uri === 'string' && p.uri.length > 0) {
          return { url: p.uri };
        }
        return null;
      })
      .filter((p: any): p is { url: string } => p !== null);
  };

  const canContinue = rulesChecked && screenshotChecked && !isProcessing;

  const handleContinue = async () => {
    if (isProcessing) return;
    setIsProcessing(true);

    try {
      // Mark terms accepted
      setAcceptedTermsAt(Date.now());

      // Get Phase-1 profile data from Convex or demo
      const phase1User = isDemoMode ? demoUser : convexUser;

      // ============================================================
      // SINGLE SOURCE OF TRUTH: Use getCurrentProfile() for import
      // This ensures Phase-2 sees the same profile as Edit Profile
      // ============================================================
      const canonicalProfile = useDemoStore.getState().getCurrentProfile();

      // FATAL: If no profile exists, block progression
      if (!canonicalProfile) {
        console.error("[P2 IMPORT] FATAL: No current profile found");
        Alert.alert("Error", "No profile found. Please complete Phase-1 setup first.");
        setIsProcessing(false);
        return;
      }

      const profileId = canonicalProfile.userId;
      let phase1PhotoSlots: PhotoSlots9 = createEmptyPhotoSlots();

      // Use photoSlots from canonical profile (single source of truth)
      if (canonicalProfile.photoSlots && canonicalProfile.photoSlots.some((s) => s !== null)) {
        phase1PhotoSlots = [...canonicalProfile.photoSlots] as PhotoSlots9;
      }
      // Fallback: Convert flat photos array to slots
      else if (canonicalProfile.photos && canonicalProfile.photos.length > 0) {
        canonicalProfile.photos.forEach((p, idx) => {
          if (idx < 9 && p.url) phase1PhotoSlots[idx] = p.url;
        });
      }
      // Final fallback: onboardingStore for fresh users
      else {
        phase1PhotoSlots = useOnboardingStore.getState().photos;
      }

      // Validate slots - invalid URIs become null but slot positions are preserved
      const validatedSlots = validatePhotoSlots(phase1PhotoSlots);

      // Count non-null slots for logging
      const nonNullSlots = validatedSlots
        .map((uri, idx) => (uri ? idx : -1))
        .filter((idx) => idx >= 0);

      if (__DEV__) {
        console.log("[P2 IMPORT]", {
          profileId,
          name: canonicalProfile.name,
          nonNullSlots,
          source: "demoStore.currentProfile",
        });
      }

      // Build Phase-1 data object with SLOT-BASED photos
      const phase1Data: Phase1ProfileData = {
        name: canonicalProfile.name || phase1User?.name || '',
        photoSlots: validatedSlots, // Pass full PhotoSlots9
        photos: validatedSlots.filter(Boolean).map((url) => ({ url: url! })), // Legacy compat
        dateOfBirth: canonicalProfile.dateOfBirth || phase1User?.dateOfBirth || '',
        gender: canonicalProfile.gender || phase1User?.gender || '',
        activities: canonicalProfile.activities || phase1User?.activities || [],
        maxDistance: canonicalProfile.maxDistance || phase1User?.maxDistance || 50,
        height: canonicalProfile.height ?? phase1User?.height ?? null,
        smoking: canonicalProfile.smoking ?? phase1User?.smoking ?? null,
        drinking: canonicalProfile.drinking ?? phase1User?.drinking ?? null,
        kids: canonicalProfile.kids ?? phase1User?.kids ?? null,
        education: canonicalProfile.education ?? phase1User?.education ?? null,
        religion: canonicalProfile.religion ?? phase1User?.religion ?? null,
      };

      importPhase1Data(phase1Data);

      // Proceed to profile setup (Step 2)
      router.push("/(main)/phase2-onboarding/photo-select" as any);
    } catch (err) {
      if (__DEV__) console.error("[Phase2Onboarding] Error:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      {/* Header */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => router.replace("/(main)/(tabs)" as any)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={22} color={C.textLight} />
        </TouchableOpacity>
        <Text style={styles.stepIndicator}>Step 1 of 3</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        {/* Welcome Section */}
        <View style={styles.welcomeSection}>
          <View style={styles.iconContainer}>
            <Ionicons name="shield-checkmark" size={48} color={C.primary} />
          </View>
          <Text style={styles.welcomeTitle}>Welcome to Private Mode</Text>
          <Text style={styles.welcomeSubtitle}>
            Create a fresh, separate identity for your private connections.
            Your Phase-2 profile is completely independent from your main profile.
          </Text>
        </View>

        {/* Terms Section */}
        <View style={styles.termsSection}>
          <View style={styles.sectionHeader}>
            <Ionicons name="document-text-outline" size={20} color={C.primary} />
            <Text style={styles.sectionTitle}>Private Mode Rules</Text>
          </View>

          <View style={styles.termsBox}>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>•</Text> Adults 18+ only — no exceptions
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>•</Text> Consent comes first — always ask, never assume
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>•</Text> "No" means no — stop immediately when asked
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>•</Text> Respect boundaries — no pressure, no manipulation
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>•</Text> No harassment, threats, stalking, or coercion
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>•</Text> No screenshots, recording, or sharing outside the app
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>•</Text> No unsolicited explicit photos or messages
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>•</Text> Violations result in suspension or permanent ban
            </Text>
          </View>

          {/* Checkboxes */}
          <TouchableOpacity
            style={[styles.checkRow, rulesChecked && styles.checkRowActive]}
            onPress={() => setRulesChecked(!rulesChecked)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={rulesChecked ? "checkbox" : "square-outline"}
              size={20}
              color={rulesChecked ? C.primary : C.textLight}
            />
            <Text style={styles.checkLabel}>
              I agree to respect consent and boundaries
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.checkRow,
              screenshotChecked && styles.checkRowActive,
            ]}
            onPress={() => setScreenshotChecked(!screenshotChecked)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={screenshotChecked ? "checkbox" : "square-outline"}
              size={20}
              color={screenshotChecked ? C.primary : C.textLight}
            />
            <Text style={styles.checkLabel}>
              I will not screenshot or share private content
            </Text>
          </TouchableOpacity>
        </View>

        {/* Info Note */}
        <View style={styles.infoNote}>
          <Ionicons name="information-circle-outline" size={18} color={C.textLight} />
          <Text style={styles.infoNoteText}>
            Your Private profile is separate from your main profile.
            You'll create new photos and preferences specifically for Private Mode.
          </Text>
        </View>
      </ScrollView>

      {/* Bottom Action */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[
            styles.continueBtn,
            !canContinue && styles.continueBtnDisabled,
          ]}
          onPress={handleContinue}
          disabled={!canContinue}
          activeOpacity={0.8}
        >
          {isProcessing ? (
            <>
              <ActivityIndicator size="small" color="#FFFFFF" />
              <Text style={styles.continueBtnText}>Importing...</Text>
            </>
          ) : (
            <>
              <Text
                style={[
                  styles.continueBtnText,
                  !canContinue && styles.continueBtnTextDisabled,
                ]}
              >
                Continue
              </Text>
              <Ionicons
                name="arrow-forward"
                size={18}
                color={canContinue ? "#FFFFFF" : C.textLight}
              />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  scrollView: { flex: 1 },

  // Top bar
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  stepIndicator: {
    fontSize: 11,
    color: C.textLight,
    fontWeight: "500",
  },

  // Welcome section
  welcomeSection: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
    alignItems: "center",
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.primary + "15",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  welcomeTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: C.text,
    textAlign: "center",
    marginBottom: 8,
  },
  welcomeSubtitle: {
    fontSize: 14,
    color: C.textLight,
    textAlign: "center",
    lineHeight: 20,
  },

  // Terms section
  termsSection: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: C.text,
  },
  termsBox: {
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  termsBullet: {
    fontSize: 13,
    color: C.text,
    lineHeight: 22,
  },
  bulletIcon: {
    color: C.primary,
    fontWeight: "700",
  },

  // Checkboxes
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: C.surface,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  checkRowActive: {
    borderColor: C.primary + "50",
    backgroundColor: C.primary + "0A",
  },
  checkLabel: {
    fontSize: 13,
    color: C.text,
    flex: 1,
    lineHeight: 18,
  },

  // Info note
  infoNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 16,
    backgroundColor: C.surface,
    borderRadius: 8,
    marginBottom: 16,
  },
  infoNoteText: {
    flex: 1,
    fontSize: 12,
    color: C.textLight,
    lineHeight: 18,
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  continueBtn: {
    flexDirection: "row",
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  continueBtnDisabled: {
    backgroundColor: C.surface,
  },
  continueBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  continueBtnTextDisabled: {
    color: C.textLight,
  },
});

/**
 * Phase 2 Onboarding - Step 1: Terms & Import from Phase-1
 *
 * Shows:
 * 1. Import preview: name, age, hobbies from Phase-1
 * 2. Photo selection: checkboxes for Phase-1 photos (max 3)
 * 3. Terms checkboxes
 * 4. Continue button
 *
 * 18+ check already done by PrivateConsentGate in _layout.tsx
 */
import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { INCOGNITO_COLORS } from "@/lib/constants";
import {
  usePrivateProfileStore,
  MAX_PHASE1_PHOTO_IMPORTS,
} from "@/stores/privateProfileStore";
import { useDemoStore } from "@/stores/demoStore";
import { useAuthStore } from "@/stores/authStore";
import { isDemoMode } from "@/hooks/useConvex";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Phase1ProfileData } from "@/stores/privateProfileStore";

const C = INCOGNITO_COLORS;
const screenWidth = Dimensions.get("window").width;
const PHOTO_SIZE = (screenWidth - 48 - 16) / 3; // 3 photos with gaps

/** Parse "YYYY-MM-DD" to local Date (noon to avoid DST issues) */
function parseDOBString(dobString: string): Date {
  if (!dobString || !/^\d{4}-\d{2}-\d{2}$/.test(dobString)) {
    return new Date(2000, 0, 1, 12, 0, 0);
  }
  const [y, m, d] = dobString.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

/**
 * Calculate age from date of birth string (uses local parsing, not UTC)
 */
function calculateAge(dateOfBirth?: string): number {
  if (!dateOfBirth) return 0;
  const dob = parseDOBString(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

/**
 * Validate a photo URL is usable
 */
function isValidPhotoUrl(url: unknown): url is string {
  return (
    typeof url === "string" &&
    url.length > 0 &&
    url !== "undefined" &&
    url !== "null" &&
    (url.startsWith("http") || url.startsWith("file://"))
  );
}

export default function Phase2OnboardingTerms() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.userId);

  // Terms checkboxes
  const [rulesChecked, setRulesChecked] = useState(false);
  const [screenshotChecked, setScreenshotChecked] = useState(false);

  // Photo selection state (which Phase-1 photos to import)
  const [selectedPhotoUrls, setSelectedPhotoUrls] = useState<string[]>([]);

  const importPhase1Data = usePrivateProfileStore((s) => s.importPhase1Data);
  const setAcceptedTermsAt = usePrivateProfileStore(
    (s) => s.setAcceptedTermsAt,
  );
  const setSelectedPhotos = usePrivateProfileStore((s) => s.setSelectedPhotos);

  const currentDemoUserId = useDemoStore((s) => s.currentDemoUserId);
  const demoProfiles = useDemoStore((s) => s.demoProfiles);

  const convexProfile = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : "skip",
  );

  // Build Phase-1 profile data for preview
  const phase1Data: Phase1ProfileData | null = useMemo(() => {
    if (isDemoMode) {
      const demoProfile = currentDemoUserId
        ? demoProfiles[currentDemoUserId]
        : null;
      if (demoProfile) {
        return {
          name: demoProfile.name,
          photos: demoProfile.photos || [],
          bio: demoProfile.bio,
          gender: demoProfile.gender,
          dateOfBirth: demoProfile.dateOfBirth,
          city: demoProfile.city,
          activities: demoProfile.activities,
          maxDistance: demoProfile.maxDistance,
          isVerified: true,
        };
      }
    } else if (convexProfile) {
      const photos =
        convexProfile.photos?.map((p: { url: string }) => ({ url: p.url })) ||
        [];
      return {
        name: convexProfile.name || "",
        photos,
        bio: convexProfile.bio,
        gender: convexProfile.gender,
        dateOfBirth: convexProfile.dateOfBirth,
        city: convexProfile.city,
        activities: convexProfile.activities,
        maxDistance: convexProfile.maxDistance,
        isVerified: convexProfile.verificationStatus === "verified",
      };
    }
    return null;
  }, [isDemoMode, currentDemoUserId, demoProfiles, convexProfile]);

  // Extract valid photos from Phase-1 (max 3 for import)
  const availablePhotos = useMemo(() => {
    if (!phase1Data?.photos) return [];
    return phase1Data.photos
      .map((p) => p.url)
      .filter(isValidPhotoUrl)
      .slice(0, MAX_PHASE1_PHOTO_IMPORTS);
  }, [phase1Data]);

  // Computed age
  const age = phase1Data ? calculateAge(phase1Data.dateOfBirth) : 0;

  // Hobbies preview (show first 3)
  const hobbiesPreview = useMemo(() => {
    const activities = phase1Data?.activities || [];
    return activities.slice(0, 3);
  }, [phase1Data]);

  const canContinue = rulesChecked && screenshotChecked;

  // Toggle photo selection
  const togglePhoto = (url: string) => {
    setSelectedPhotoUrls((prev) => {
      if (prev.includes(url)) {
        return prev.filter((u) => u !== url);
      }
      // Max 3 photos
      if (prev.length >= MAX_PHASE1_PHOTO_IMPORTS) {
        return prev;
      }
      return [...prev, url];
    });
  };

  // Select all photos
  const selectAllPhotos = () => {
    setSelectedPhotoUrls(availablePhotos);
  };

  // Clear all photos
  const clearAllPhotos = () => {
    setSelectedPhotoUrls([]);
  };

  const handleContinue = () => {
    setAcceptedTermsAt(Date.now());

    // Import Phase-1 data if available
    if (phase1Data) {
      importPhase1Data(phase1Data);
    }

    // Set selected photos for the next step
    // Only use selected Phase-1 photos (user can add more from camera roll in next step)
    if (selectedPhotoUrls.length > 0) {
      setSelectedPhotos([], selectedPhotoUrls);
    }

    router.push("/(main)/phase2-onboarding/photo-select" as any);
  };

  const handleSkipImport = () => {
    // Clear photo selection and proceed
    setSelectedPhotoUrls([]);
    setAcceptedTermsAt(Date.now());

    // Still import basic info (name, age, etc.) but no photos
    if (phase1Data) {
      const dataWithoutPhotos = { ...phase1Data, photos: [] };
      importPhase1Data(dataWithoutPhotos);
    }

    router.push("/(main)/phase2-onboarding/photo-select" as any);
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
        {/* Import Preview Section */}
        {phase1Data && (
          <View style={styles.importSection}>
            <View style={styles.sectionHeader}>
              <Ionicons
                name="person-circle-outline"
                size={20}
                color={C.primary}
              />
              <Text style={styles.sectionTitle}>Import from Phase 1</Text>
            </View>

            {/* Profile Info Preview */}
            <View style={styles.profilePreview}>
              <View style={styles.profileRow}>
                <Text style={styles.previewLabel}>Name</Text>
                <Text style={styles.previewValue}>
                  {phase1Data.name || "Not set"}
                </Text>
              </View>
              <View style={styles.profileRow}>
                <Text style={styles.previewLabel}>Age</Text>
                <Text style={styles.previewValue}>
                  {age > 0 ? `${age} years` : "Not set"}
                </Text>
              </View>
              {hobbiesPreview.length > 0 && (
                <View style={styles.profileRow}>
                  <Text style={styles.previewLabel}>Hobbies</Text>
                  <Text style={styles.previewValue} numberOfLines={1}>
                    {hobbiesPreview.join(", ")}
                    {(phase1Data.activities?.length || 0) > 3 ? "..." : ""}
                  </Text>
                </View>
              )}
              {phase1Data.isVerified && (
                <View style={styles.verifiedBadge}>
                  <Ionicons name="shield-checkmark" size={14} color="#4CAF50" />
                  <Text style={styles.verifiedText}>Verified Profile</Text>
                </View>
              )}
            </View>

            {/* Photo Selection */}
            {availablePhotos.length > 0 && (
              <View style={styles.photoSection}>
                <View style={styles.photoHeader}>
                  <Text style={styles.photoLabel}>
                    Select photos to import ({selectedPhotoUrls.length}/
                    {MAX_PHASE1_PHOTO_IMPORTS})
                  </Text>
                  <View style={styles.photoActions}>
                    <TouchableOpacity
                      onPress={selectAllPhotos}
                      style={styles.photoAction}
                    >
                      <Text style={styles.photoActionText}>All</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={clearAllPhotos}
                      style={styles.photoAction}
                    >
                      <Text style={styles.photoActionText}>None</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.photoGrid}>
                  {availablePhotos.map((url, index) => {
                    const isSelected = selectedPhotoUrls.includes(url);
                    return (
                      <TouchableOpacity
                        key={`photo-${index}`}
                        style={[
                          styles.photoSlot,
                          isSelected && styles.photoSlotSelected,
                        ]}
                        onPress={() => togglePhoto(url)}
                        activeOpacity={0.8}
                      >
                        <Image
                          source={{ uri: url }}
                          style={styles.photoImage}
                        />
                        <View
                          style={[
                            styles.checkbox,
                            isSelected && styles.checkboxSelected,
                          ]}
                        >
                          {isSelected && (
                            <Ionicons
                              name="checkmark"
                              size={14}
                              color="#FFFFFF"
                            />
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={styles.photoHint}>
                  You can add more photos from your camera roll in the next step
                </Text>
              </View>
            )}

            {/* Skip Import Option */}
            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleSkipImport}
            >
              <Text style={styles.skipButtonText}>
                Skip import, start fresh
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Terms Section */}
        <View style={styles.termsSection}>
          <View style={styles.sectionHeader}>
            <Ionicons name="shield-checkmark" size={20} color={C.primary} />
            <Text style={styles.sectionTitle}>Private Mode Rules</Text>
          </View>

          <View style={styles.termsBox}>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>*</Text> Adults 18+ only - no
              exceptions
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>*</Text> Consent comes first -
              always ask, never assume
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>*</Text> "No" means no - stop
              immediately when asked
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>*</Text> Respect boundaries - no
              pressure, no manipulation
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>*</Text> No harassment, threats,
              stalking, or coercion
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>*</Text> No screenshots,
              recording, or sharing outside the app
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>*</Text> No unsolicited explicit
              photos or messages
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>*</Text> Violations result in
              suspension or permanent ban
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
          <Text
            style={[
              styles.continueBtnText,
              !canContinue && styles.continueBtnTextDisabled,
            ]}
          >
            Continue to Phase 2
          </Text>
          <Ionicons
            name="arrow-forward"
            size={18}
            color={canContinue ? "#FFFFFF" : C.textLight}
          />
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

  // Import section
  importSection: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
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

  // Profile preview
  profilePreview: {
    backgroundColor: C.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  profileRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  previewLabel: {
    fontSize: 13,
    color: C.textLight,
  },
  previewValue: {
    fontSize: 13,
    color: C.text,
    fontWeight: "500",
    flex: 1,
    textAlign: "right",
    marginLeft: 12,
  },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: C.accent,
  },
  verifiedText: {
    fontSize: 12,
    color: "#4CAF50",
    fontWeight: "500",
  },

  // Photo section
  photoSection: {
    marginBottom: 12,
  },
  photoHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  photoLabel: {
    fontSize: 13,
    color: C.textLight,
  },
  photoActions: {
    flexDirection: "row",
    gap: 12,
  },
  photoAction: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  photoActionText: {
    fontSize: 12,
    color: C.primary,
    fontWeight: "600",
  },
  photoGrid: {
    flexDirection: "row",
    gap: 8,
  },
  photoSlot: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE * 1.25,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: C.surface,
    borderWidth: 2,
    borderColor: "transparent",
  },
  photoSlotSelected: {
    borderColor: C.primary,
  },
  photoImage: {
    width: "100%",
    height: "100%",
  },
  checkbox: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
  checkboxSelected: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  photoHint: {
    fontSize: 11,
    color: C.textLight,
    marginTop: 8,
    fontStyle: "italic",
  },

  // Skip button
  skipButton: {
    alignItems: "center",
    paddingVertical: 10,
  },
  skipButtonText: {
    fontSize: 13,
    color: C.textLight,
    textDecorationLine: "underline",
  },

  // Terms section
  termsSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  termsBox: {
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  termsBullet: {
    fontSize: 12,
    color: C.text,
    lineHeight: 18,
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
    paddingVertical: 10,
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
    fontSize: 12,
    color: C.text,
    flex: 1,
    lineHeight: 16,
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

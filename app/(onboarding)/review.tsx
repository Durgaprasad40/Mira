import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  COLORS,
  GENDER_OPTIONS,
  RELATIONSHIP_INTENTS,
  ACTIVITY_FILTERS,
  SMOKING_OPTIONS,
  DRINKING_OPTIONS,
  KIDS_OPTIONS,
  EXERCISE_OPTIONS,
  PETS_OPTIONS,
  EDUCATION_OPTIONS,
  RELIGION_OPTIONS,
} from "@/lib/constants";
import { Button } from "@/components/ui";
import { useOnboardingStore, LGBTQ_OPTIONS } from "@/stores/onboardingStore";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { Ionicons } from "@expo/vector-icons";
import { Id } from "@/convex/_generated/dataModel";
import { isDemoMode } from "@/hooks/useConvex";
import { useDemoStore } from "@/stores/demoStore";
import { OnboardingProgressHeader } from "@/components/OnboardingProgressHeader";

/**
 * Parse "YYYY-MM-DD" string to local Date object.
 * Uses noon to avoid DST edge cases.
 * DO NOT use new Date("YYYY-MM-DD") as it parses as UTC!
 */
function parseDOBString(dobString: string): Date {
  if (!dobString || !/^\d{4}-\d{2}-\d{2}$/.test(dobString)) {
    return new Date(2000, 0, 1, 12, 0, 0);
  }
  const [y, m, d] = dobString.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

export default function ReviewScreen() {
  const {
    name,
    nickname,
    dateOfBirth,
    gender,
    lgbtqSelf,
    lgbtqPreference,
    photos,
    bio,
    height,
    weight,
    smoking,
    drinking,
    kids,
    exercise,
    pets,
    insect,
    education,
    educationOther,
    religion,
    jobTitle,
    company,
    school,
    lookingFor,
    relationshipIntent,
    activities,
    profilePrompts,
    minAge,
    maxAge,
    maxDistance,
    displayPhotoVariant,
    setStep,
  } = useOnboardingStore();
  const router = useRouter();
  const { userId, setOnboardingCompleted, faceVerificationPassed } = useAuthStore();
  const demoProfile = useDemoStore((s) => isDemoMode && userId ? s.demoProfiles[userId] : null);

  // CRITICAL: Check demoProfile.faceVerificationPassed for demo mode (persisted across logout)
  const isVerified = isDemoMode
    ? !!(demoProfile?.faceVerificationPassed || faceVerificationPassed)
    : faceVerificationPassed;

  // CHECKPOINT GATE: Block access if face verification not completed
  React.useEffect(() => {
    if (isVerified) {
      console.log("[REVIEW_GATE] verified=true -> allow");
      return;
    }
    console.log("[REVIEW_GATE] verified=false -> block");
    router.replace("/(onboarding)/face-verification" as any);
  }, [isVerified, router]);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState("");

  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const generateUploadUrl = useMutation(api.photos.generateUploadUrl);

  const calculateAge = (dob: string) => {
    const birthDate = parseDOBString(dob); // Use local parsing, not UTC
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }
    return age;
  };

  // OB-9: Upload a single photo to Convex storage with retry logic
  const MAX_UPLOAD_RETRIES = 2;

  const uploadPhoto = async (uri: string): Promise<Id<"_storage"> | null> => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
      try {
        // Get upload URL from Convex
        const uploadUrl = await generateUploadUrl();

        // Fetch the image as blob
        const response = await fetch(uri);
        const blob = await response.blob();

        // Upload to Convex storage
        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            "Content-Type": blob.type || "image/jpeg",
          },
          body: blob,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed with status ${uploadResponse.status}`);
        }

        const result = await uploadResponse.json();
        return result.storageId as Id<"_storage">;
      } catch (error: any) {
        lastError = error;
        console.error(`Photo upload attempt ${attempt + 1} failed:`, error);
        // Only retry if not the last attempt
        if (attempt < MAX_UPLOAD_RETRIES) {
          // Small delay before retry (exponential backoff)
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    // All retries failed
    console.error("Photo upload failed after all retries:", lastError);
    return null;
  };

  const handleComplete = async () => {
    if (!userId) {
      Alert.alert("Error", "User not authenticated");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isDemoMode) {
        // Demo mode: save profile locally, skip Convex
        // OB-4 fix: Do NOT mark onboarding complete here — that happens in tutorial.tsx
        // to ensure user sees the tutorial before being marked complete.
        setUploadProgress("Saving profile...");
        const demoStore = useDemoStore.getState();
        // Filter out null slots for display/storage
        const validPhotos = photos.filter((p): p is string => p !== null && p !== '');

        // Build profile data, only including basic fields if they're not empty
        // This prevents overwriting existing demoProfile data with empty values
        // if onboardingStore was reset (e.g., after forced logout)
        const profileData: any = {
          bio,
          photos: validPhotos.map((uri) => ({ url: uri })),
          height,
          weight,
          smoking,
          drinking,
          kids,
          exercise,
          pets: pets as string[],
          insect: insect ?? undefined,
          education,
          religion,
          jobTitle,
          company,
          school,
          lookingFor: lookingFor as string[],
          relationshipIntent: relationshipIntent as string[],
          activities: activities as string[],
          profilePrompts,
          minAge,
          maxAge,
          maxDistance,
        };

        // Only include basic fields if they have values (don't overwrite with empty)
        if (name && name.trim().length > 0) profileData.name = name.trim();
        if (nickname && nickname.length > 0) profileData.handle = nickname;
        if (dateOfBirth && dateOfBirth.length > 0) profileData.dateOfBirth = dateOfBirth;
        if (gender) profileData.gender = gender;
        // LGBTQ fields are optional - only save if user selected any
        if (lgbtqSelf.length > 0) profileData.lgbtqSelf = lgbtqSelf;
        if (lgbtqPreference.length > 0) profileData.lgbtqPreference = lgbtqPreference;

        demoStore.saveDemoProfile(userId, profileData);
        // OB-4: Profile saved, but completion flags set ONLY in tutorial.tsx after user finishes tutorial
        setStep("tutorial");
        router.push("/(onboarding)/tutorial" as any);
        return;
      }

      // Live mode: upload photos + complete onboarding via Convex
      const photoStorageIds: Id<"_storage">[] = [];
      let failedUploads = 0;

      // Filter out null slots for upload
      const photosToUpload = photos.filter((p): p is string => p !== null && p !== '');

      if (photosToUpload.length > 0) {
        setUploadProgress("Uploading photos...");
        for (let i = 0; i < photosToUpload.length; i++) {
          setUploadProgress(`Uploading photo ${i + 1} of ${photosToUpload.length}...`);
          const storageId = await uploadPhoto(photosToUpload[i]);
          if (storageId) {
            photoStorageIds.push(storageId);
          } else {
            failedUploads++;
          }
        }
      }

      // OB-9 fix: If any photos failed to upload, alert user and allow retry
      if (failedUploads > 0) {
        const uploadedCount = photoStorageIds.length;
        const totalCount = photosToUpload.length;

        // At least one photo is required for a profile
        if (uploadedCount === 0) {
          Alert.alert(
            "Upload Failed",
            "We couldn't upload your photos. Please check your internet connection and try again.",
            [{ text: "OK" }]
          );
          return;
        }

        // Some photos uploaded but not all - let user decide
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            "Some Photos Failed",
            `${uploadedCount} of ${totalCount} photos uploaded successfully. Continue with uploaded photos or try again?`,
            [
              { text: "Try Again", onPress: () => resolve(false) },
              { text: "Continue", onPress: () => resolve(true) },
            ]
          );
        });

        if (!proceed) {
          return;
        }
      }

      setUploadProgress("Saving profile...");

      // Prepare onboarding data
      const onboardingData: any = {
        userId: userId as Id<"users">,
        name,
        dateOfBirth,
        gender,
        bio,
        height: height || undefined,
        weight: weight || undefined,
        smoking: smoking || undefined,
        drinking: drinking || undefined,
        kids: kids || undefined,
        exercise: exercise || undefined,
        pets: pets.length > 0 ? pets : undefined,
        insect: insect ?? undefined,
        education: education || undefined,
        religion: religion || undefined,
        jobTitle: jobTitle || undefined,
        company: company || undefined,
        school: school || undefined,
        lookingFor: lookingFor.length > 0 ? lookingFor : undefined,
        relationshipIntent:
          relationshipIntent.length > 0 ? relationshipIntent : undefined,
        activities: activities.length > 0 ? activities : undefined,
        minAge,
        maxAge,
        maxDistance,
        photoStorageIds:
          photoStorageIds.length > 0 ? photoStorageIds : undefined,
      };

      // Remove undefined values
      Object.keys(onboardingData).forEach((key) => {
        if (onboardingData[key] === undefined) {
          delete onboardingData[key];
        }
      });

      // Submit all onboarding data to backend
      await completeOnboarding(onboardingData);

      setOnboardingCompleted(true);
      setStep("tutorial");
      router.push("/(onboarding)/tutorial" as any);
    } catch (error: any) {
      console.error("Onboarding error:", error);
      Alert.alert("Error", error.message || "Failed to complete onboarding");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (step: string) => {
    // CENTRAL EDIT HUB: All edits from Review pass editFromReview=true
    // so each screen knows to:
    // 1. Pre-fill from demoProfile
    // 2. Return directly to Review on Continue (not continue through onboarding flow)
    router.push(`/(onboarding)/${step}?editFromReview=true` as any);
  };

  // Filter valid photos for display
  const validPhotos = photos.filter((uri): uri is string => uri !== null && uri !== '');

  // Helper to get label from options array
  const getLabel = (options: { value: string; label: string }[], value: string | null) => {
    if (!value) return null;
    return options.find((o) => o.value === value)?.label ?? value;
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
    <OnboardingProgressHeader />
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Review Your Profile</Text>
      <Text style={styles.subtitle}>
        Make sure everything looks good before you start matching!
      </Text>

      {/* Photos Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Photos</Text>
          <TouchableOpacity onPress={() => handleEdit("additional-photos")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        {validPhotos.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.photosScroll}
          >
            {validPhotos.map((uri, index) => (
              <View key={index} style={styles.photoWrapper}>
                <Image source={{ uri }} style={styles.photoThumbnail} />
                {index === 0 && displayPhotoVariant !== 'original' && (
                  <View style={styles.variantBadge}>
                    <Text style={styles.variantBadgeText}>
                      {displayPhotoVariant === 'blurred' ? 'Blurred' : 'Cartoon'}
                    </Text>
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.emptyText}>No photos added</Text>
        )}
      </View>

      {/* Basic Info Section - Name, Handle, Age, Gender, LGBTQ Identity */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Basic Info</Text>
          <TouchableOpacity onPress={() => handleEdit("basic-info")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Name:</Text>
          <Text style={styles.infoValue}>{name || demoProfile?.name || "Not set"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>User ID:</Text>
          <Text style={styles.infoValue}>@{nickname || demoProfile?.handle || "—"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Age:</Text>
          <Text style={styles.infoValue}>
            {(dateOfBirth || demoProfile?.dateOfBirth) ? calculateAge(dateOfBirth || demoProfile?.dateOfBirth || "") : "N/A"}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Gender:</Text>
          <Text style={styles.infoValue}>
            {(gender || demoProfile?.gender) ? GENDER_OPTIONS.find((g) => g.value === (gender || demoProfile?.gender))?.label : "Not set"}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>LGBTQ (Identity):</Text>
          <Text style={styles.infoValue}>
            {(() => {
              const values = lgbtqSelf.length > 0 ? lgbtqSelf : (demoProfile?.lgbtqSelf || []);
              if (values.length === 0) return "–";
              return values.map((v: string) => LGBTQ_OPTIONS.find((o) => o.value === v)?.label || v).join(", ");
            })()}
          </Text>
        </View>
      </View>

      {/* Photos & Bio Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Photos & Bio</Text>
          <TouchableOpacity onPress={() => handleEdit("additional-photos")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.bioText}>{bio || demoProfile?.bio || "No bio added"}</Text>
      </View>

      {/* Prompts Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Prompts</Text>
          <TouchableOpacity onPress={() => handleEdit("prompts")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        {(profilePrompts.length > 0 || (demoProfile?.profilePrompts && demoProfile.profilePrompts.length > 0)) ? (
          (profilePrompts.length > 0 ? profilePrompts : demoProfile?.profilePrompts || []).map((prompt, index) => (
            <View key={index} style={styles.promptItem}>
              <Text style={styles.promptQuestion}>{prompt.question}</Text>
              <Text style={styles.promptAnswer}>{prompt.answer}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.emptyText}>No prompts added</Text>
        )}
      </View>

      {/* Profile Details Section - Height, Weight, Job, Company, School, Education, Religion */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Profile Details</Text>
          <TouchableOpacity onPress={() => handleEdit("profile-details")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Height:</Text>
          <Text style={styles.infoValue}>{(height || demoProfile?.height) ? `${height || demoProfile?.height} cm` : "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Weight:</Text>
          <Text style={styles.infoValue}>{(weight || demoProfile?.weight) ? `${weight || demoProfile?.weight} kg` : "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Job Title:</Text>
          <Text style={styles.infoValue}>{jobTitle || demoProfile?.jobTitle || "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Company:</Text>
          <Text style={styles.infoValue}>{company || demoProfile?.company || "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>School:</Text>
          <Text style={styles.infoValue}>{school || demoProfile?.school || "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Education:</Text>
          <Text style={styles.infoValue}>
            {(() => {
              const eduValue = education || demoProfile?.education || null;
              if (!eduValue) return "–";
              if (eduValue === 'other') {
                const otherText = educationOther || demoProfile?.educationOther || '';
                return otherText ? `Other: ${otherText}` : 'Other';
              }
              return getLabel(EDUCATION_OPTIONS, eduValue) || "–";
            })()}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Religion:</Text>
          <Text style={styles.infoValue}>{getLabel(RELIGION_OPTIONS, religion || demoProfile?.religion || null) || "–"}</Text>
        </View>
      </View>

      {/* Lifestyle Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Lifestyle</Text>
          <TouchableOpacity onPress={() => handleEdit("profile-details/lifestyle")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Smoking:</Text>
          <Text style={styles.infoValue}>{getLabel(SMOKING_OPTIONS, smoking || demoProfile?.smoking || null) || "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Drinking:</Text>
          <Text style={styles.infoValue}>{getLabel(DRINKING_OPTIONS, drinking || demoProfile?.drinking || null) || "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Kids:</Text>
          <Text style={styles.infoValue}>{getLabel(KIDS_OPTIONS, kids || demoProfile?.kids || null) || "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Exercise:</Text>
          <Text style={styles.infoValue}>{getLabel(EXERCISE_OPTIONS, exercise || demoProfile?.exercise || null) || "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Pets:</Text>
          <Text style={styles.infoValue}>
            {(() => {
              const petsData = pets.length > 0 ? pets : (demoProfile?.pets || []);
              if (petsData.length === 0) return "–";
              return petsData.map((p) => PETS_OPTIONS.find((o) => o.value === p)?.label ?? p).join(", ");
            })()}
          </Text>
        </View>
      </View>

      {/* Looking For Section - Gender Preference, LGBTQ Preference, Age, Distance */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Looking For</Text>
          <TouchableOpacity onPress={() => handleEdit("preferences")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Gender:</Text>
          <Text style={styles.infoValue}>
            {(() => {
              const lookingForData = lookingFor.length > 0 ? lookingFor : (demoProfile?.lookingFor || []);
              if (lookingForData.length === 0) return "–";
              return lookingForData.map((g) => GENDER_OPTIONS.find((opt) => opt.value === g)?.label || g).join(", ");
            })()}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>LGBTQ (Preference):</Text>
          <Text style={styles.infoValue}>
            {(() => {
              const values = lgbtqPreference.length > 0 ? lgbtqPreference : (demoProfile?.lgbtqPreference || []);
              if (values.length === 0) return "–";
              return values.map((v: string) => LGBTQ_OPTIONS.find((o) => o.value === v)?.label || v).join(", ");
            })()}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Age Range:</Text>
          <Text style={styles.infoValue}>{minAge || demoProfile?.minAge || 18} - {maxAge || demoProfile?.maxAge || 70} years</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Distance:</Text>
          <Text style={styles.infoValue}>Up to {maxDistance || demoProfile?.maxDistance || 50} miles</Text>
        </View>
      </View>

      {/* Relationship Goals Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Relationship Goals</Text>
          <TouchableOpacity onPress={() => handleEdit("preferences")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        {(() => {
          const intentData = relationshipIntent.length > 0 ? relationshipIntent : (demoProfile?.relationshipIntent || []);
          if (intentData.length === 0) return <Text style={styles.emptyText}>Not specified</Text>;
          return (
            <View style={styles.chipsContainer}>
              {intentData.map((intent) => {
                const intentObj = RELATIONSHIP_INTENTS.find((r) => r.value === intent);
                return (
                  <View key={intent} style={styles.chip}>
                    <Text style={styles.chipText}>
                      {intentObj?.emoji} {intentObj?.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        })()}
      </View>

      {/* Interests Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Interests</Text>
          <TouchableOpacity onPress={() => handleEdit("preferences")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        {(() => {
          const activitiesData = activities.length > 0 ? activities : (demoProfile?.activities || []);
          if (activitiesData.length === 0) return <Text style={styles.emptyText}>No interests selected</Text>;
          return (
            <View style={styles.chipsContainer}>
              {activitiesData.map((activity) => {
                const activityObj = ACTIVITY_FILTERS.find((a) => a.value === activity);
                return (
                  <View key={activity} style={styles.chip}>
                    <Text style={styles.chipText}>
                      {activityObj?.emoji} {activityObj?.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        })()}
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        {uploadProgress ? (
          <Text style={styles.progressText}>{uploadProgress}</Text>
        ) : null}
        <Button
          title={isSubmitting ? "Please wait..." : "Complete Profile"}
          variant="primary"
          onPress={handleComplete}
          loading={isSubmitting}
          disabled={isSubmitting}
          fullWidth
        />
      </View>
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: 24,
  },
  progressText: {
    fontSize: 14,
    color: COLORS.primary,
    textAlign: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 32,
    lineHeight: 22,
  },
  section: {
    marginBottom: 24,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.text,
  },
  editLink: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: "500",
  },
  photosScroll: {
    marginTop: 12,
  },
  photoWrapper: {
    position: 'relative',
    marginRight: 12,
  },
  photoThumbnail: {
    width: 80,
    height: 120,
    borderRadius: 12,
  },
  variantBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    right: 4,
    backgroundColor: COLORS.primary + 'E0',
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  variantBadgeText: {
    fontSize: 9,
    fontWeight: '600',
    color: COLORS.white,
  },
  infoRow: {
    flexDirection: "row",
    marginBottom: 8,
  },
  infoLabel: {
    fontSize: 15,
    color: COLORS.textLight,
    width: 100,
  },
  infoValue: {
    fontSize: 15,
    color: COLORS.text,
    fontWeight: "500",
    flex: 1,
  },
  bioText: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 22,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontStyle: "italic",
    marginTop: 8,
  },
  promptItem: {
    marginBottom: 12,
  },
  promptQuestion: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textLight,
    marginBottom: 4,
  },
  promptAnswer: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 20,
  },
  chipsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundDark,
  },
  chipText: {
    fontSize: 13,
    color: COLORS.text,
  },
  preferenceText: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 8,
  },
  footer: {
    marginTop: 24,
  },
});

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
import { useRouter } from "expo-router";
import {
  COLORS,
  GENDER_OPTIONS,
  RELATIONSHIP_INTENTS,
  ACTIVITY_FILTERS,
} from "@/lib/constants";
import { Button } from "@/components/ui";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { Ionicons } from "@expo/vector-icons";
import { Id } from "@/convex/_generated/dataModel";
import { isDemoMode } from "@/hooks/useConvex";
import { useDemoStore } from "@/stores/demoStore";

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
    dateOfBirth,
    gender,
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
    setStep,
  } = useOnboardingStore();
  const router = useRouter();
  const { userId, setOnboardingCompleted, faceVerificationPassed } = useAuthStore();

  // CHECKPOINT GATE: Block access if face verification not completed
  React.useEffect(() => {
    if (!faceVerificationPassed) {
      console.log("[REVIEW_GATE] blocked: faceVerificationPassed=false");
      router.replace("/(onboarding)/face-verification" as any);
    }
  }, [faceVerificationPassed, router]);
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
        demoStore.saveDemoProfile(userId, {
          name,
          dateOfBirth,
          gender: gender ?? undefined,
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
        });
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
    setStep(step as any);
    router.push(`/(onboarding)/${step}` as any);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Review Your Profile</Text>
      <Text style={styles.subtitle}>
        Make sure everything looks good before you start matching!
      </Text>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Photos</Text>
          <TouchableOpacity onPress={() => handleEdit("additional-photos")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.photosScroll}
        >
          {photos.filter((uri): uri is string => uri !== null && uri !== '').map((uri, index) => (
            <Image key={index} source={{ uri }} style={styles.photoThumbnail} />
          ))}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Basic Info</Text>
          <TouchableOpacity onPress={() => handleEdit("basic-info")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Name:</Text>
          <Text style={styles.infoValue}>{name}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Age:</Text>
          <Text style={styles.infoValue}>
            {dateOfBirth ? calculateAge(dateOfBirth) : "N/A"}
          </Text>
        </View>
        {gender && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Gender:</Text>
            <Text style={styles.infoValue}>
              {GENDER_OPTIONS.find((g) => g.value === gender)?.label}
            </Text>
          </View>
        )}
        {height && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Height:</Text>
            <Text style={styles.infoValue}>{height} cm</Text>
          </View>
        )}
      </View>

      {bio && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Bio</Text>
            <TouchableOpacity onPress={() => handleEdit("bio")}>
              <Text style={styles.editLink}>Edit</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.bioText}>{bio}</Text>
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Looking For</Text>
          <TouchableOpacity onPress={() => handleEdit("preferences")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.chipsContainer}>
          {lookingFor.map((gender) => (
            <View key={gender} style={styles.chip}>
              <Text style={styles.chipText}>
                {GENDER_OPTIONS.find((g) => g.value === gender)?.label}
              </Text>
            </View>
          ))}
        </View>
        <Text style={styles.preferenceText}>
          Age: {minAge} - {maxAge} years
        </Text>
        <Text style={styles.preferenceText}>
          Distance: Up to {maxDistance} miles
        </Text>
      </View>

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
  );
}

const styles = StyleSheet.create({
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
  photoThumbnail: {
    width: 80,
    height: 80,
    borderRadius: 12,
    marginRight: 12,
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

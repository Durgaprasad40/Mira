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
    education,
    religion,
    jobTitle,
    company,
    school,
    lookingFor,
    relationshipIntent,
    activities,
    minAge,
    maxAge,
    maxDistance,
    setStep,
  } = useOnboardingStore();
  const router = useRouter();
  const { userId, setOnboardingCompleted } = useAuthStore();
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState("");

  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const generateUploadUrl = useMutation(api.photos.generateUploadUrl);

  const calculateAge = (dob: string) => {
    const birthDate = new Date(dob);
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

  // Upload a single photo to Convex storage
  const uploadPhoto = async (uri: string): Promise<Id<"_storage"> | null> => {
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
        throw new Error("Failed to upload photo");
      }

      const result = await uploadResponse.json();
      return result.storageId as Id<"_storage">;
    } catch (error) {
      console.error("Photo upload error:", error);
      return null;
    }
  };

  const handleComplete = async () => {
    if (!userId) {
      Alert.alert("Error", "User not authenticated");
      return;
    }

    setIsSubmitting(true);
    try {
      // Upload all photos to Convex storage
      const photoStorageIds: Id<"_storage">[] = [];

      if (photos.length > 0) {
        setUploadProgress("Uploading photos...");
        for (let i = 0; i < photos.length; i++) {
          setUploadProgress(`Uploading photo ${i + 1} of ${photos.length}...`);
          const storageId = await uploadPhoto(photos[i]);
          if (storageId) {
            photoStorageIds.push(storageId);
          }
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
          {photos.map((uri, index) => (
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

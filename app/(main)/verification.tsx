import React, { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  BackHandler,
} from "react-native";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { asUserId } from "@/convex/id";
import { useAuthStore } from "@/stores/authStore";
import { COLORS } from "@/lib/constants";
import { isDemoMode } from "@/hooks/useConvex";
import { computeEnforcementLevel } from "@/lib/securityEnforcement";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type VerificationState = "unverified" | "camera" | "pending" | "verified";

export default function VerificationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const [state, setState] = useState<VerificationState>("unverified");
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  // FIX: Backend expects { userId }, not { token }
  const verificationStatus = useQuery(
    api.verification.getVerificationStatus,
    !isDemoMode && userId ? { userId } : "skip"
  );

  const createSession = useMutation(api.verification.createVerificationSession);
  const generateUploadUrl = useMutation(api.photos.generateUploadUrl);

  // Safe back navigation: verification is often entered via router.replace()
  // (security gate), so there is no back stack. Fall back to home to avoid
  // the "GO_BACK was not handled by any navigator" error.
  const safeBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(main)/(tabs)/home" as any);
    }
  }, [router]);

  // Determine if the user is locked (security_only) — hide dismiss/close in that case
  // FIX: Use getCurrentUser with userId instead of getCurrentUserFromToken
  const currentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && token ? { token } : "skip"
  );
  const isLocked = !isDemoMode && currentUser
    ? (currentUser.verificationEnforcementLevel === "security_only" ||
       computeEnforcementLevel({
         createdAt: currentUser.createdAt,
         verificationStatus: (currentUser.verificationStatus as any) || "unverified",
       }) === "security_only")
    : false;

  // Android hardware back button handling — mirrors safeBack semantics.
  // When the user is in security_only (isLocked), swallow hardware back so
  // they can't bypass the security gate.
  React.useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (isLocked) return true; // swallow — stay on screen
      safeBack();
      return true;
    });
    return () => sub.remove();
  }, [safeBack, isLocked]);

  // Set initial state from backend
  React.useEffect(() => {
    if (isDemoMode) return;
    if (verificationStatus) {
      if (verificationStatus.status === "verified") setState("verified");
      else if (verificationStatus.status === "pending_verification")
        setState("pending");
    }
  }, [verificationStatus]);

  const handleStartVerification = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          "Camera Required",
          "Please enable camera access to verify your identity."
        );
        return;
      }
    }
    setState("camera");
  };

  const handleCapture = async () => {
    if (!cameraRef.current) {
      Alert.alert("Camera not ready", "Please wait a moment and try again.");
      return;
    }
    try {
      // Silence the shutter sound on iOS via `shutterSound: false`. Android
      // uses the `mute` prop on CameraView (set below) — note some regions
      // enforce shutter sound at the OS level regardless.
      const options: any = { quality: 0.8, shutterSound: false };
      const photo: any = await cameraRef.current.takePictureAsync(options);
      if (photo && typeof photo.uri === "string" && photo.uri) {
        setCapturedUri(photo.uri);
      }
    } catch (error) {
      Alert.alert("Error", "Failed to capture photo. Please try again.");
    }
  };

  const handleRetake = () => {
    setCapturedUri(null);
  };

  const handleConfirm = async () => {
    if (!capturedUri) return;

    if (isDemoMode) {
      setState("verified");
      return;
    }

    const currentUserId = asUserId(userId);
    const sessionToken = typeof token === "string" ? token.trim() : "";
    if (!currentUserId || !sessionToken) {
      Alert.alert("Session expired", "Please sign in again to continue verification.");
      return;
    }

    setIsUploading(true);
    try {
      // Upload the selfie
      const uploadUrl = await generateUploadUrl({ token: sessionToken });
      const response = await fetch(capturedUri);
      const blob = await response.blob();

      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": blob.type || "image/jpeg" },
        body: blob,
      });
      if (!uploadResponse.ok) {
        throw new Error("Failed to upload your selfie. Please try again.");
      }

      const { storageId } = await uploadResponse.json();
      if (!storageId) {
        throw new Error("Could not save your selfie. Please try again.");
      }

      // Create verification session
      await createSession({
        userId: currentUserId,
        selfieStorageId: storageId,
      });

      setState("pending");
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to submit verification.");
    } finally {
      setIsUploading(false);
    }
  };

  const renderUnverified = () => (
    <View style={styles.centeredContent}>
      <View style={styles.iconContainer}>
        <Ionicons name="shield-outline" size={80} color={COLORS.primary} />
      </View>
      <Text style={styles.title}>Verify Your Identity</Text>
      <Text style={styles.subtitle}>
        Take a quick selfie to confirm it&apos;s you. Your selfie stays private
        and is never shown to others.
      </Text>
      <View style={styles.benefitsContainer}>
        <View style={styles.benefitRow}>
          <Ionicons
            name="checkmark-circle"
            size={20}
            color={COLORS.success}
          />
          <Text style={styles.benefitText}>
            Verified profiles get up to 3x more matches
          </Text>
        </View>
        <View style={styles.benefitRow}>
          <Ionicons
            name="checkmark-circle"
            size={20}
            color={COLORS.success}
          />
          <Text style={styles.benefitText}>
            Unlock full reach and visibility
          </Text>
        </View>
        <View style={styles.benefitRow}>
          <Ionicons
            name="checkmark-circle"
            size={20}
            color={COLORS.success}
          />
          <Text style={styles.benefitText}>
            Get a verified badge on your profile
          </Text>
        </View>
      </View>
      <TouchableOpacity
        style={styles.primaryButton}
        onPress={handleStartVerification}
        accessibilityLabel="Start verification"
        accessibilityHint="Opens the camera to take a verification selfie."
      >
        <Text style={styles.primaryButtonText}>Start Verification</Text>
      </TouchableOpacity>
      {!isLocked && (
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={safeBack}
          accessibilityLabel="Go back to your profile"
        >
          <Text style={styles.secondaryButtonText}>Maybe Later</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderCamera = () => (
    <View style={styles.cameraContainer}>
      {capturedUri ? (
        <View style={styles.previewContainer}>
          <View style={styles.previewPlaceholder}>
            <Ionicons name="person-circle" size={120} color={COLORS.primary} />
            <Text style={styles.previewText}>Selfie ready to submit</Text>
          </View>
          <View style={styles.cameraActions}>
            <TouchableOpacity
              style={styles.retakeButton}
              onPress={handleRetake}
              accessibilityLabel="Retake selfie"
            >
              <Text style={styles.retakeButtonText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryButton, styles.confirmButton]}
              onPress={handleConfirm}
              disabled={isUploading}
              accessibilityLabel="Confirm and submit verification selfie"
              accessibilityHint="Sends your selfie for review."
            >
              {isUploading ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.primaryButtonText}>Confirm & Submit</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.cameraWrapper}>
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFillObject}
              facing="front"
              mute
            />
            <View style={[StyleSheet.absoluteFillObject, styles.faceGuide]} pointerEvents="none">
              <View style={styles.faceOval} />
              <Text style={styles.guideText}>
                Position your face in the oval
              </Text>
              <Text style={styles.guideSubtext}>
                Good lighting, face the camera
              </Text>
            </View>
          </View>
          <View style={styles.captureContainer}>
            <TouchableOpacity
              style={styles.captureButton}
              onPress={handleCapture}
              accessibilityLabel="Capture verification selfie"
              accessibilityHint="Takes a selfie for verification."
            >
              <View style={styles.captureInner} />
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );

  const renderPending = () => (
    <View style={styles.centeredContent}>
      <View style={styles.iconContainer}>
        <Ionicons name="shield-half-outline" size={80} color={COLORS.warning} />
        <Ionicons
          name="time-outline"
          size={32}
          color={COLORS.warning}
          style={styles.overlayIcon}
        />
      </View>
      <Text style={styles.title}>Verification Pending</Text>
      <Text style={styles.subtitle}>
        We&apos;re reviewing your selfie. This usually only takes a little
        while.
      </Text>
      <View style={styles.privacyNote}>
        <Ionicons name="lock-closed" size={16} color={COLORS.textLight} />
        <Text style={styles.privacyText}>
          Your selfie stays private and is never shown to others
        </Text>
      </View>
      {!isLocked && (
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={safeBack}
          accessibilityLabel="Back to profile"
        >
          <Text style={styles.primaryButtonText}>Back to Profile</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderVerified = () => (
    <View style={styles.centeredContent}>
      <View style={styles.iconContainer}>
        <Ionicons
          name="shield-checkmark"
          size={80}
          color={COLORS.success}
        />
      </View>
      <Text style={styles.title}>You're Verified!</Text>
      <Text style={styles.subtitle}>
        Your profile now shows a verified badge. Enjoy full access to all
        features.
      </Text>
      <TouchableOpacity
        style={[styles.primaryButton, { backgroundColor: COLORS.success }]}
        onPress={() => {
          // In security_only mode there's no stack to go back to (user was redirected here),
          // so replace to home. Otherwise, pop back if possible, else fall back to home.
          if (isLocked) {
            router.replace("/(main)/(tabs)/home" as any);
          } else {
            safeBack();
          }
        }}
        accessibilityLabel="Finish verification"
      >
        <Text style={styles.primaryButtonText}>Done</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {!isLocked && (
          <TouchableOpacity
            onPress={safeBack}
            style={styles.backBtn}
            accessibilityLabel="Close verification"
          >
            <Ionicons name="close" size={28} color={COLORS.text} />
          </TouchableOpacity>
        )}
      </View>
      {state === "unverified" && renderUnverified()}
      {state === "camera" && renderCamera()}
      {state === "pending" && renderPending()}
      {state === "verified" && renderVerified()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    padding: 4,
  },
  centeredContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  iconContainer: {
    marginBottom: 24,
    position: "relative",
  },
  overlayIcon: {
    position: "absolute",
    bottom: -4,
    right: -4,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.text,
    textAlign: "center",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 32,
  },
  benefitsContainer: {
    alignSelf: "stretch",
    marginBottom: 32,
    gap: 12,
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  benefitText: {
    fontSize: 15,
    color: COLORS.text,
    flex: 1,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 28,
    alignSelf: "stretch",
    alignItems: "center",
    marginBottom: 12,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: "700",
  },
  secondaryButton: {
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: COLORS.textLight,
    fontSize: 15,
  },
  cameraContainer: {
    flex: 1,
  },
  cameraWrapper: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: COLORS.black,
  },
  camera: {
    flex: 1,
  },
  faceGuide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  faceOval: {
    width: 220,
    height: 280,
    borderRadius: 110,
    borderWidth: 3,
    borderColor: COLORS.white,
    borderStyle: "dashed",
    marginBottom: 20,
  },
  guideText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  guideSubtext: {
    color: COLORS.white,
    fontSize: 14,
    marginTop: 4,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  captureContainer: {
    alignItems: "center",
    paddingVertical: 24,
    backgroundColor: COLORS.black,
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
  },
  captureInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.white,
  },
  previewContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  previewPlaceholder: {
    alignItems: "center",
    marginBottom: 32,
  },
  previewText: {
    fontSize: 16,
    color: COLORS.textLight,
    marginTop: 12,
  },
  cameraActions: {
    alignSelf: "stretch",
    gap: 12,
  },
  retakeButton: {
    paddingVertical: 14,
    borderRadius: 28,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  retakeButtonText: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: "600",
  },
  confirmButton: {
    marginBottom: 0,
  },
  privacyNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 32,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
  },
  privacyText: {
    fontSize: 13,
    color: COLORS.textLight,
    flex: 1,
  },
});

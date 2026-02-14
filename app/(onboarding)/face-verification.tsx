import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, CameraType, useCameraPermissions, Camera } from 'expo-camera';
import { COLORS } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { Ionicons } from '@expo/vector-icons';
import { log } from '@/utils/logger';

export default function FaceVerificationScreen() {
  const { setVerificationPhoto, setStep } = useOnboardingStore();
  const router = useRouter();
  const [facing, setFacing] = useState<CameraType>('front');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [captured, setCaptured] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isPermissionBlocked, setIsPermissionBlocked] = useState(false);
  const [isCheckingPermission, setIsCheckingPermission] = useState(false);

  // Check permission status on mount and refresh if needed
  useEffect(() => {
    const checkPermission = async () => {
      log.info('[FaceVerification]', 'Initial permission check', {
        permissionExists: !!permission,
        granted: permission?.granted,
        canAskAgain: permission?.canAskAgain,
      });

      // If hook says not granted, double-check with direct API call
      // This handles cases where Android settings changed while app was backgrounded
      if (permission && !permission.granted) {
        const freshStatus = await Camera.getCameraPermissionsAsync();
        log.info('[FaceVerification]', 'Fresh permission status from API', {
          granted: freshStatus.granted,
          canAskAgain: freshStatus.canAskAgain,
          status: freshStatus.status,
        });

        if (freshStatus.granted) {
          // Permission was granted in settings, refresh the hook state
          log.info('[FaceVerification]', 'Permission granted in settings, refreshing...');
          await requestPermission();
        } else if (!freshStatus.canAskAgain) {
          // Permission permanently denied
          log.warn('[FaceVerification]', 'Permission permanently blocked');
          setIsPermissionBlocked(true);
        }
      }
    };

    checkPermission();
  }, [permission]);

  // Handler for the "Grant Permission" button
  const handleGrantPermission = useCallback(async () => {
    log.info('[FaceVerification]', 'Grant Permission button pressed');
    setIsCheckingPermission(true);

    try {
      // First, check current permission status directly from the system
      const currentStatus = await Camera.getCameraPermissionsAsync();
      log.info('[FaceVerification]', 'Current permission status', {
        granted: currentStatus.granted,
        canAskAgain: currentStatus.canAskAgain,
        status: currentStatus.status,
      });

      if (currentStatus.granted) {
        // Permission already granted - just refresh the hook state
        log.info('[FaceVerification]', 'Permission already granted, refreshing hook state');
        await requestPermission();
        return;
      }

      if (!currentStatus.canAskAgain) {
        // Permission permanently denied - show settings option
        log.warn('[FaceVerification]', 'Permission blocked, showing settings option');
        setIsPermissionBlocked(true);
        return;
      }

      // Can ask again - request permission
      log.info('[FaceVerification]', 'Requesting permission from system');
      const result = await requestPermission();
      log.info('[FaceVerification]', 'Permission request result', {
        granted: result.granted,
        canAskAgain: result.canAskAgain,
        status: result.status,
      });

      if (!result.granted && !result.canAskAgain) {
        setIsPermissionBlocked(true);
      }
    } catch (error) {
      log.error('[FaceVerification]', 'Error handling permission', { error });
      Alert.alert('Error', 'Failed to request camera permission. Please try again.');
    } finally {
      setIsCheckingPermission(false);
    }
  }, [requestPermission]);

  // Handler for opening system settings
  const handleOpenSettings = useCallback(async () => {
    log.info('[FaceVerification]', 'Opening system settings');
    try {
      await Linking.openSettings();
    } catch (error) {
      log.error('[FaceVerification]', 'Failed to open settings', { error });
      Alert.alert('Error', 'Unable to open settings. Please go to Settings > Apps > Mira > Permissions manually.');
    }
  }, []);

  const takePicture = async () => {
    if (!cameraRef.current) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: false,
      });

      if (photo) {
        setPhotoUri(photo.uri);
        setCaptured(true);
        setVerificationPhoto(photo.uri);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    }
  };

  const retake = () => {
    setCaptured(false);
    setPhotoUri(null);
  };

  const handleNext = () => {
    if (!photoUri) {
      Alert.alert('Photo Required', 'Please take a verification photo to continue.');
      return;
    }

    // TODO: Send to backend for face verification
    setStep('additional_photos');
    router.push('/(onboarding)/additional-photos' as any);
  };

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    // Show different UI based on whether permission is permanently blocked
    if (isPermissionBlocked) {
      return (
        <View style={styles.container}>
          <Ionicons name="settings-outline" size={64} color={COLORS.textLight} />
          <Text style={styles.title}>Camera Access Blocked</Text>
          <Text style={styles.subtitle}>
            Camera permission was denied. Please enable it in your device settings to continue with verification.
          </Text>
          <Button
            title="Open Settings"
            variant="primary"
            onPress={handleOpenSettings}
            style={styles.permissionButton}
          />
          <TouchableOpacity
            style={styles.retryLink}
            onPress={() => {
              setIsPermissionBlocked(false);
              handleGrantPermission();
            }}
          >
            <Text style={styles.retryLinkText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.container}>
        <Ionicons name="camera-outline" size={64} color={COLORS.textLight} />
        <Text style={styles.title}>Camera Permission Required</Text>
        <Text style={styles.subtitle}>
          We need camera access to verify your identity with a selfie.
        </Text>
        <Button
          title={isCheckingPermission ? "Checking..." : "Grant Permission"}
          variant="primary"
          onPress={handleGrantPermission}
          disabled={isCheckingPermission}
          style={styles.permissionButton}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Face Verification</Text>
      <Text style={styles.subtitle}>
        Take a selfie to verify your identity. Make sure your face is clearly visible and well-lit.
      </Text>

      <View style={styles.cameraContainer}>
        {!captured ? (
          <>
            {/* CameraView must be self-closing with no children (Android requirement) */}
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing={facing}
              mode="picture"
            />
            {/* Overlay sits on top using absolute positioning */}
            <View style={styles.cameraOverlay} pointerEvents="box-none">
              <View style={styles.faceGuide} />
              <View style={styles.instructions}>
                <Text style={styles.instructionText}>
                  Position your face within the frame
                </Text>
              </View>
            </View>
          </>
        ) : (
          <View style={styles.previewContainer}>
            {photoUri && (
              <View style={styles.preview}>
                <Text style={styles.previewText}>Photo captured!</Text>
                <View style={styles.previewActions}>
                  <Button
                    title="Retake"
                    variant="outline"
                    onPress={retake}
                    style={styles.retakeButton}
                  />
                  <Button
                    title="Looks Good"
                    variant="primary"
                    onPress={handleNext}
                    style={styles.confirmButton}
                  />
                </View>
              </View>
            )}
          </View>
        )}
      </View>

      {!captured && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.flipButton}
            onPress={() => setFacing(facing === 'back' ? 'front' : 'back')}
          >
            <Ionicons name="camera-reverse" size={24} color={COLORS.white} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.captureButton} onPress={takePicture}>
            <View style={styles.captureButtonInner} />
          </TouchableOpacity>
          <View style={styles.flipButton} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 22,
  },
  cameraContainer: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 24,
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    // Absolute positioning to sit on top of CameraView
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  faceGuide: {
    width: 250,
    height: 300,
    borderRadius: 125,
    borderWidth: 3,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
  },
  instructions: {
    position: 'absolute',
    bottom: 40,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
  },
  instructionText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '500',
  },
  previewContainer: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  preview: {
    alignItems: 'center',
  },
  previewText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 24,
  },
  previewActions: {
    flexDirection: 'row',
    gap: 12,
  },
  retakeButton: {
    minWidth: 120,
  },
  confirmButton: {
    minWidth: 120,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 24,
  },
  flipButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: COLORS.white,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButtonInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.white,
  },
  permissionButton: {
    marginTop: 24,
  },
  retryLink: {
    marginTop: 16,
    padding: 12,
  },
  retryLinkText: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: '500',
  },
});

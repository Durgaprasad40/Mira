import { ExpoConfig, ConfigContext } from "expo/config";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `[app.config] Missing ${name}. Set a rotated, restricted Google Maps key via local env or EAS secrets before building Mira.`
    );
  }
  return value;
}

const googleMapsApiKey = requireEnv("GOOGLE_MAPS_API_KEY");

export default ({ config }: ConfigContext): ExpoConfig => ({
  name: "Mira",
  slug: "mira-app",
  version: "1.0.1",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  scheme: "mira",
  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#FF6B6B",
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.mira.dating",
    infoPlist: {
      NSCameraUsageDescription:
        "Mira needs camera access for photo verification and taking profile photos.",
      NSPhotoLibraryUsageDescription:
        "Mira needs photo library access to upload profile photos.",
      NSMicrophoneUsageDescription:
        "Mira needs microphone access for video recording.",
      NSLocationWhenInUseUsageDescription:
        "Mira uses your location to show people near you.",
      NSFaceIDUsageDescription: "Use Face ID for secure login.",
    },
    config: {
      googleMapsApiKey,
    },
  },
  android: {
    package: "com.mira.dating",
    versionCode: 2,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#FF6B6B",
    },
    softwareKeyboardLayoutMode: "resize",
    permissions: [
      "CAMERA",
      "RECORD_AUDIO",
      "READ_EXTERNAL_STORAGE",
      "WRITE_EXTERNAL_STORAGE",
      "READ_MEDIA_IMAGES",
      "READ_MEDIA_VIDEO",
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "VIBRATE",
    ],
    config: {
      googleMaps: {
        apiKey: googleMapsApiKey,
      },
    },
  },
  web: {
    bundler: "metro",
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-router",
    [
      "expo-camera",
      {
        cameraPermission:
          "Allow Mira to access your camera for photo verification.",
        microphonePermission:
          "Allow Mira to record audio for video messages.",
        recordAudioAndroid: true,
      },
    ],
    [
      "expo-media-library",
      {
        photosPermission:
          "Allow Mira to access your photos for sending secure media.",
        savePhotosPermission: "Allow Mira to save photos to your gallery.",
        isAccessMediaLocationEnabled: true,
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "Allow Mira to access your photos for your profile.",
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Allow Mira to use your location to show people near you.",
      },
    ],
    "@react-native-community/datetimepicker",
    "expo-video",
    "react-native-vision-camera",
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    router: {
      origin: false,
    },
    eas: {
      projectId: "1cd22b4e-8a76-49f1-8459-765d071fa24a",
    },
  },
});

import { ExpoConfig, ConfigContext } from "expo/config";

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
      // Phase-1 Background Crossed Paths (iOS): Always + When-in-Use is only
      // requested after the user explicitly opts into background Crossed Paths
      // in settings. Text is user-facing and framed around the exact benefit.
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Allow Mira to detect people you cross paths with even when the app is closed. Your location is never shared in real time.",
      UIBackgroundModes: ["location", "fetch"],
      NSFaceIDUsageDescription: "Use Face ID for secure login.",
    },
    config: {
      googleMapsApiKey:
        process.env.GOOGLE_MAPS_IOS_API_KEY ||
        process.env.GOOGLE_MAPS_API_KEY ||
        "",
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
      // Phase-2 Android Discovery Mode: user-initiated, time-limited
      // background location. ACCESS_BACKGROUND_LOCATION is required for
      // location updates while the app is not in the foreground. The
      // foreground-service permissions are required by Android 14+ for
      // location-typed foreground services. POST_NOTIFICATIONS (Android
      // 13+) lets the ongoing foreground-service notification render.
      "ACCESS_BACKGROUND_LOCATION",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_LOCATION",
      "POST_NOTIFICATIONS",
      "VIBRATE",
    ],
    config: {
      googleMaps: {
        apiKey:
          process.env.GOOGLE_MAPS_ANDROID_API_KEY ||
          process.env.GOOGLE_MAPS_API_KEY ||
          "",
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
          "Allow Mira to use your location to show people near you while you're using the app.",
        // iOS Phase-1: Always permission + UIBackgroundModes so that
        // Significant Location Change wakes the app when it's terminated.
        // Android Phase-2: Discovery Mode. Background permission is
        // requested only when the user opts into Discovery Mode, which is
        // time-limited (default 4h) and surfaces a persistent foreground-
        // service notification. This is NOT always-on Android tracking.
        locationAlwaysAndWhenInUsePermission:
          "Allow Mira to detect people you cross paths with even when the app is closed. Your location is never shared in real time.",
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
            // Android 14+ foreground-service requirements. expo-location's
            // native foreground service is used when startLocationUpdatesAsync
            // is called with a `foregroundService` options block (Task 4).
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

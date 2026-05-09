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
      // Phase-3 Background Crossed Paths — copy is intentionally specific:
      // it names the feature, scopes the use to crossed paths, and notes that
      // background use only happens after the user explicitly enables it from
      // Nearby Settings. The OS will only show this string AFTER the user
      // explicitly opts in via the in-app explainer + accept flow; the UI
      // never auto-prompts it during normal app launch.
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Mira may use location in the background ONLY for the Background Crossed Paths feature, and only after you explicitly turn it on. You can disable it anytime in Nearby Settings.",
      // UIBackgroundModes is enforced at the app level. We add 'location' so
      // the iOS Significant Location Change service (used by the Phase-3
      // background task) is permitted to wake the app. The task itself is
      // still gated client- and server-side and never starts automatically.
      UIBackgroundModes: ["location"],
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
      // Phase-3 Background Crossed Paths — Android background-location +
      // foreground-service-location declarations. ALL still gated by the
      // backend `bgCrossedPathsEnabled` feature flag and the client
      // `BG_CROSSED_PATHS_FEATURE_READY` constant; the OS prompt is never
      // triggered until the user explicitly turns on the in-app toggle.
      // Android 14+ requires FOREGROUND_SERVICE_LOCATION as a separate
      // declaration; FOREGROUND_SERVICE alone is no longer sufficient.
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
    // Sentry must be first so its prebuild modifications run before other plugins.
    // Wires up native Sentry SDK for iOS/Android and source map upload during EAS builds.
    "@sentry/react-native/expo",
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
        // Phase-3 Background Crossed Paths plugin config. This DOES NOT
        // start any background tracking; it only declares to the native
        // build that the app is capable of background location IF the
        // user explicitly enables it in Nearby Settings AND the backend
        // feature flag is on. The actual OS prompt is fired by the
        // Phase-3 hook (useBackgroundLocation) and only after the user
        // taps the explainer's accept CTA.
        locationAlwaysAndWhenInUsePermission:
          "Mira may use location in the background ONLY for Background Crossed Paths, and only after you explicitly turn it on. You can disable it anytime in Nearby Settings.",
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        isIosBackgroundLocationEnabled: true,
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

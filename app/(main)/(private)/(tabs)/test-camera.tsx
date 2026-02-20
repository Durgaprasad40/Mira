import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  Platform,
} from "react-native";
import {
  Camera,
  useCameraDevice,
  useFrameProcessor,
} from "react-native-vision-camera";
import { Worklets } from "react-native-worklets-core";
import {
  detectFaces,
  type FaceDetectionResult,
} from "../../../../../modules/mira-face-detector/src";

// =============================================================================
// Constants
// =============================================================================

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const CIRCLE_SIZE = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) * 0.56;
const THROTTLE_MS = 200;

// =============================================================================
// Component
// =============================================================================

export default function TestCameraScreen() {
  const device = useCameraDevice("front");
  const [permissionReady, setPermissionReady] = useState(false);
  const [faceData, setFaceData] = useState<FaceDetectionResult>({
    hasFace: false,
    facesCount: 0,
  });

  const lastUpdateRef = useRef<number>(0);

  // Bridge function from worklet to JS
  const updateFaceData = useCallback((data: FaceDetectionResult) => {
    const now = Date.now();
    if (now - lastUpdateRef.current < THROTTLE_MS) return;
    lastUpdateRef.current = now;
    setFaceData(data);
  }, []);

  const updateFaceDataWorklet = Worklets.createRunOnJS(updateFaceData);

  // Frame processor
  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet";
      const result = detectFaces(frame);
      updateFaceDataWorklet(result);
    },
    [updateFaceDataWorklet]
  );

  // Request permissions on mount
  useEffect(() => {
    (async () => {
      const cam = await Camera.requestCameraPermission();
      const mic = await Camera.requestMicrophonePermission();
      setPermissionReady(cam === "granted" && mic === "granted");
    })();
  }, []);

  // =============================================================================
  // Render helpers
  // =============================================================================

  const formatAngle = (val?: number) =>
    val !== undefined ? `${val.toFixed(1)}°` : "—";

  const formatProb = (val?: number) =>
    val !== undefined ? `${(val * 100).toFixed(0)}%` : "—";

  const getCircleColor = () => {
    if (!faceData.hasFace) return "#FF3B30"; // Red - no face
    if (faceData.facesCount > 1) return "#FFCC00"; // Yellow - multiple faces
    return "#34C759"; // Green - single face detected
  };

  const getStatusText = () => {
    if (!faceData.hasFace) return "No face detected";
    if (faceData.facesCount > 1) return `${faceData.facesCount} faces detected`;
    return "Face detected";
  };

  // =============================================================================
  // Render
  // =============================================================================

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Loading front camera…</Text>
      </View>
    );
  }

  if (!permissionReady) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Camera/Mic permission required</Text>
        <Pressable
          style={styles.btn}
          onPress={async () => {
            const cam = await Camera.requestCameraPermission();
            const mic = await Camera.requestMicrophonePermission();
            setPermissionReady(cam === "granted" && mic === "granted");
          }}
        >
          <Text style={styles.btnText}>Grant</Text>
        </Pressable>
      </View>
    );
  }

  const primary = faceData.primary;

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        photo={false}
        video={true}
        audio={false}
        frameProcessor={frameProcessor}
      />

      {/* Prompt */}
      <View style={styles.promptWrap}>
        <Text style={styles.promptText}>Mira Face Detector</Text>
        <Text
          style={[
            styles.statusText,
            { color: faceData.hasFace ? "#34C759" : "#FF3B30" },
          ]}
        >
          {getStatusText()}
        </Text>
      </View>

      {/* Circle overlay */}
      <View style={styles.circleContainer}>
        <View
          style={[
            styles.circle,
            {
              width: CIRCLE_SIZE,
              height: CIRCLE_SIZE,
              borderRadius: CIRCLE_SIZE / 2,
              borderColor: getCircleColor(),
            },
          ]}
        />
      </View>

      {/* Debug box */}
      <View style={styles.debugBox}>
        <Text style={styles.debugTitle}>Face Detection Debug</Text>
        <Text style={styles.debugText}>
          hasFace: {faceData.hasFace ? "YES" : "NO"}
        </Text>
        <Text style={styles.debugText}>facesCount: {faceData.facesCount}</Text>

        {primary && (
          <>
            <Text style={[styles.debugText, { marginTop: 6 }]}>
              — Primary Face —
            </Text>
            <Text style={styles.debugText}>
              yaw: {formatAngle(primary.yaw)}
            </Text>
            <Text style={styles.debugText}>
              pitch: {formatAngle(primary.pitch)}
            </Text>
            <Text style={styles.debugText}>
              roll: {formatAngle(primary.roll)}
            </Text>
            <Text style={styles.debugText}>
              leftEye: {formatProb(primary.leftEyeOpenProb)}
            </Text>
            <Text style={styles.debugText}>
              rightEye: {formatProb(primary.rightEyeOpenProb)}
            </Text>
            <Text style={styles.debugText}>
              smiling: {formatProb(primary.smilingProb)}
            </Text>
            {primary.bounds && (
              <Text style={styles.debugText}>
                bounds: {primary.bounds.w.toFixed(0)}x{primary.bounds.h.toFixed(0)}
              </Text>
            )}
          </>
        )}

        {faceData.frameWidth && faceData.frameHeight && (
          <Text style={[styles.debugText, { color: "#888", marginTop: 4 }]}>
            frame: {faceData.frameWidth}x{faceData.frameHeight}
          </Text>
        )}
      </View>
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "black" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "black",
  },
  text: { fontSize: 16, marginBottom: 12, color: "white" },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#333",
  },
  btnText: { color: "white", fontWeight: "700" },

  // Prompt
  promptWrap: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  promptText: {
    color: "white",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
  statusText: {
    fontSize: 16,
    fontWeight: "600",
    marginTop: 4,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },

  // Circle
  circleContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  circle: {
    borderWidth: 4,
    backgroundColor: "transparent",
  },

  // Debug
  debugBox: {
    position: "absolute",
    bottom: 40,
    left: 16,
    right: 16,
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 12,
    padding: 12,
  },
  debugTitle: {
    color: "#0f0",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
  },
  debugText: {
    color: "white",
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginBottom: 1,
  },
});

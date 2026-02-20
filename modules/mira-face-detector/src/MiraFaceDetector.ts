import { VisionCameraProxy, type Frame } from 'react-native-vision-camera';

// =============================================================================
// Types
// =============================================================================

export interface FaceBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PrimaryFace {
  bounds: FaceBounds;
  yaw?: number;
  pitch?: number;
  roll?: number;
  leftEyeOpenProb?: number;
  rightEyeOpenProb?: number;
  smilingProb?: number;
}

export interface FaceDetectionResult {
  hasFace: boolean;
  facesCount: number;
  primary?: PrimaryFace;
  frameWidth?: number;
  frameHeight?: number;
}

// =============================================================================
// Plugin initialization
// =============================================================================

const plugin = VisionCameraProxy.initFrameProcessorPlugin('miraFaceDetector', {});

if (!plugin) {
  console.warn(
    '[MiraFaceDetector] Failed to initialize plugin. ' +
    'Make sure the native module is properly linked and rebuilt.'
  );
}

// =============================================================================
// Detection function (call from frame processor)
// =============================================================================

/**
 * Detect faces in a camera frame.
 * Must be called from within a frame processor (worklet context).
 * Throttled internally to ~5 fps.
 *
 * @param frame - The camera frame to process
 * @returns Face detection result with face count and primary face data
 */
export function detectFaces(frame: Frame): FaceDetectionResult {
  'worklet';

  if (!plugin) {
    return { hasFace: false, facesCount: 0 };
  }

  try {
    const result = plugin.call(frame) as FaceDetectionResult;
    return result ?? { hasFace: false, facesCount: 0 };
  } catch {
    return { hasFace: false, facesCount: 0 };
  }
}

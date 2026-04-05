/**
 * Face Verification Service
 *
 * Handles face verification by capturing selfie frames.
 *
 * SECURITY: All verification decisions are made SERVER-SIDE ONLY.
 * Demo mode is controlled exclusively by process.env.DEMO_MODE on the server.
 * There is NO client-side bypass - all requests go through Convex verification.
 *
 * Flow:
 * 1. Client captures 3 selfie frames
 * 2. Best frame is selected and sent to server
 * 3. Server stores selfie and processes based on server-side mode:
 *    - Demo mode (env): Auto-approves
 *    - Live mode: Sets PENDING for admin review
 *
 * Safe Guards:
 * - Any error results in FAIL status (user NOT verified)
 * - Default state is always unverified
 */

import { isDemoMode, convex } from '@/hooks/useConvex';
import { api } from '@/convex/_generated/api';

// =============================================================================
// Types
// =============================================================================

export interface CapturedFrame {
  /** File path or Base64 encoded image data */
  base64: string;
  /** Whether a face was detected in this frame (client-side detection) */
  hasFace: boolean;
  /** Timestamp when frame was captured */
  timestamp: number;
}

export interface FaceVerificationRequest {
  /** User ID for logging/tracking */
  userId: string;
  /** URI to the profile photo to compare against (for reference) */
  profilePhotoUri: string;
  /** Array of captured frames from verification */
  frames: CapturedFrame[];
}

export type FaceMatchStatus = 'PASS' | 'PENDING' | 'FAIL';

// Structured reason codes for client-side routing decisions
export type FaceMatchReasonCode =
  | 'NO_REFERENCE_PHOTO'      // No verification reference photo uploaded
  | 'REFERENCE_NO_FACE'       // Reference photo has no face
  | 'REFERENCE_MULTI_FACE'    // Reference photo has multiple faces
  | 'SELFIE_NO_FACE'          // Selfie has no detectable face
  | 'SELFIE_MULTI_FACE'       // Selfie has multiple faces
  | 'MISMATCH'                // Faces don't match (admin rejected)
  | 'PENDING_REVIEW'          // Pending manual review (default state)
  | 'MATCH';                  // Faces match successfully (admin approved)

export interface FaceVerificationResponse {
  /** Overall verification result */
  status: FaceMatchStatus;
  /** Whether verification passed (status === 'PASS') */
  success: boolean;
  /** Confidence/similarity score 0-100 (null for demo/manual modes) */
  score: number | null;
  /** Human readable message */
  message: string | null;
  /** Reason for the result */
  reason?: string | null;
  /** Structured reason code for routing decisions */
  reasonCode?: FaceMatchReasonCode;
  /** Verification mode */
  mode?: 'demo_auto' | 'manual_review';
  /** Detailed error info */
  details?: {
    sourceHasFace: boolean;
    targetHasFace: boolean;
    sourceFaceCount: number;
    targetFaceCount: number;
  };
}

// =============================================================================
// Helper: Select best frame from captures
// =============================================================================

function selectBestFrame(frames: CapturedFrame[]): CapturedFrame | null {
  // Prefer frames that have face detected
  const framesWithFaces = frames.filter(f => f.hasFace);

  if (framesWithFaces.length > 0) {
    // Return the middle frame (usually best quality)
    return framesWithFaces[Math.floor(framesWithFaces.length / 2)];
  }

  // Fall back to any frame
  if (frames.length > 0) {
    return frames[Math.floor(frames.length / 2)];
  }

  return null;
}

// =============================================================================
// Helper: Convert image to base64
// =============================================================================

async function imageToBase64(imagePath: string): Promise<string> {
  try {
    // If it's already base64, return as-is
    if (imagePath.startsWith('data:image')) {
      return imagePath.split(',')[1];
    }

    // If it's a file path, read and convert to base64 using fetch + blob
    if (imagePath.startsWith('file://') || imagePath.startsWith('/')) {
      // Ensure the path has file:// prefix for fetch
      const fileUri = imagePath.startsWith('file://') ? imagePath : `file://${imagePath}`;
      const response = await fetch(fileUri);
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          // Remove the data URL prefix (e.g., "data:image/jpeg;base64,")
          const base64Data = result.split(',')[1];
          resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    // If it's a URL, fetch and convert
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      const response = await fetch(imagePath);
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    throw new Error('Unsupported image format');
  } catch (error) {
    console.error('[FaceVerify] Error converting image to base64:', error);
    throw error;
  }
}

// =============================================================================
// Mock Verification (Demo Mode Only)
// =============================================================================

async function mockVerify(request: FaceVerificationRequest): Promise<FaceVerificationResponse> {
  console.log('[FaceVerify] DEMO MODE - Mock verification (manual review mode)');
  console.log('[FaceVerify] frames received:', request.frames.length);

  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 1500));

  // Check if all frames have faces detected
  const framesWithFaces = request.frames.filter(f => f.hasFace).length;

  console.log(`[FaceVerify] frames with faces: ${framesWithFaces}/${request.frames.length}`);

  // In demo mode, accept if at least 2 frames have faces and return PENDING
  if (framesWithFaces >= 2) {
    return {
      status: 'PENDING',
      success: false, // Not yet verified - pending review
      score: 0,
      message: 'Your selfie has been captured. Your profile is now pending manual verification.',
      reason: 'Demo mode - selfie captured for manual review',
      reasonCode: 'PENDING_REVIEW',
    };
  } else {
    return {
      status: 'FAIL',
      success: false,
      score: 0,
      message: 'Could not detect face in frames. Please try again with better lighting.',
      reason: 'No face detected',
      reasonCode: 'SELFIE_NO_FACE',
    };
  }
}

// =============================================================================
// Server-Side Verification (Demo Auto-Approve or Manual Review)
// =============================================================================

async function serverVerify(request: FaceVerificationRequest, demoMode: boolean): Promise<FaceVerificationResponse> {
  const mode = demoMode ? 'demo_auto' : 'manual_review';
  console.log(`[FACE_VERIFY_START] mode=${mode} userId=${request.userId} frames=${request.frames.length}`);

  // Select the best frame for verification
  const bestFrame = selectBestFrame(request.frames);
  if (!bestFrame) {
    console.log(`[FACE_VERIFY_FAIL] mode=${mode} reason=no_frames userId=${request.userId}`);
    return {
      status: 'FAIL',
      success: false,
      score: null,
      message: 'No frames captured. Please try again.',
      reason: 'No frames available',
      reasonCode: 'SELFIE_NO_FACE',
      mode,
    };
  }

  console.log(`[FACE_VERIFY_PROGRESS] mode=${mode} Selected best frame for verification`);

  try {
    // Convert the frame to base64
    const selfieBase64 = await imageToBase64(bestFrame.base64);
    console.log(`[FACE_VERIFY_PROGRESS] mode=${mode} Converted selfie to base64, length=${selfieBase64.length}`);

    // Call the Convex action (demo mode determined server-side via process.env.DEMO_MODE)
    console.log(`[FACE_VERIFY_PROGRESS] mode=${mode} Calling Convex faceVerification.compareFaces...`);

    const result = await convex.action(api.faceVerification.compareFaces, {
      userId: request.userId,
      selfieBase64,
    });

    // Log result based on status
    if (result.status === 'PASS') {
      console.log(`[FACE_VERIFY_SUCCESS] mode=${result.mode} userId=${request.userId} score=${result.score} reasonCode=${result.reasonCode}`);
    } else if (result.status === 'FAIL') {
      console.log(`[FACE_VERIFY_FAIL] mode=${result.mode} userId=${request.userId} reasonCode=${result.reasonCode}`);
    } else {
      console.log(`[FACE_VERIFY_PENDING] mode=${result.mode} userId=${request.userId} reasonCode=${result.reasonCode}`);
    }

    return {
      status: result.status,
      success: result.status === 'PASS',
      score: result.score,
      message: result.reason,
      reason: result.reason,
      reasonCode: result.reasonCode as FaceMatchReasonCode,
      mode: result.mode as 'demo_auto' | 'manual_review',
      details: result.details,
    };

  } catch (error: any) {
    // SAFE GUARD: Any error results in FAIL status - user is NOT verified
    console.error(`[FACE_VERIFY_FAIL] mode=${mode} userId=${request.userId} error=${error.message}`);

    return {
      status: 'FAIL',
      success: false,
      score: null,
      message: 'Failed to submit selfie. Please try again.',
      reason: error.message,
      reasonCode: 'SELFIE_NO_FACE',
      mode,
    };
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Submit user's selfie for face verification.
 *
 * Modes:
 * - DEMO (isDemoMode=true): Auto-approve immediately, returns PASS
 * - LIVE (isDemoMode=false): Pending manual review by admin, returns PENDING
 *
 * @param request - Contains userId, profilePhotoUri (reference), and captured frames
 * @returns Verification result with status (PASS/PENDING/FAIL), mode, and message
 */
export async function verifyFace(request: FaceVerificationRequest): Promise<FaceVerificationResponse> {
  const mode = isDemoMode ? 'demo_auto' : 'manual_review';
  console.log('[FACE_VERIFY_START] ========================================');
  console.log(`[FACE_VERIFY_START] mode=${mode} userId=${request.userId} frames=${request.frames.length}`);
  console.log('[FACE_VERIFY_START] ========================================');

  try {
    // All verification goes through server - mode is determined server-side
    const result = await serverVerify(request, isDemoMode);
    return result;
  } catch (error: any) {
    // SAFE GUARD: Any unexpected error results in FAIL - user is NOT verified
    console.error(`[FACE_VERIFY_FAIL] mode=${mode} userId=${request.userId} unexpected_error=${error.message}`);

    return {
      status: 'FAIL',
      success: false,
      score: null,
      message: 'Failed to submit selfie. Please try again.',
      reason: error.message,
      reasonCode: 'SELFIE_NO_FACE',
      mode,
    };
  }
}

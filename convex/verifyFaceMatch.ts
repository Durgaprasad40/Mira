import { v } from "convex/values";
import { mutation } from "./_generated/server";

/**
 * MINIMAL face verification function.
 * Does NOT patch users table.
 * Does NOT insert into any table.
 * Just returns pass/fail result for client to handle.
 *
 * Demo mode: passes if all 3 frames are provided, fails otherwise.
 * Production: would call actual ML face comparison API.
 */
export const verifyFaceMatch = mutation({
  args: {
    mainPhotoUri: v.string(),
    frames: v.array(v.string()),
  },
  handler: async (_ctx, args): Promise<{
    success: boolean;
    passed: boolean;
    score: number;
    reason?: string;
  }> => {
    const { mainPhotoUri, frames } = args;

    console.log("[verifyFaceMatch] Called with:", {
      mainPhotoUri: mainPhotoUri ? "provided" : "missing",
      frameCount: frames.length,
    });

    // Validation: must have main photo
    if (!mainPhotoUri || mainPhotoUri.trim() === "") {
      console.log("[verifyFaceMatch] FAIL: No main photo");
      return {
        success: true,
        passed: false,
        score: 0,
        reason: "No main profile photo provided",
      };
    }

    // Validation: must have exactly 3 frames
    if (frames.length !== 3) {
      console.log(`[verifyFaceMatch] FAIL: Expected 3 frames, got ${frames.length}`);
      return {
        success: true,
        passed: false,
        score: 0,
        reason: `Expected 3 frames, received ${frames.length}`,
      };
    }

    // Validation: all frames must be non-empty
    for (let i = 0; i < frames.length; i++) {
      if (!frames[i] || frames[i].trim() === "") {
        console.log(`[verifyFaceMatch] FAIL: Frame ${i + 1} is empty`);
        return {
          success: true,
          passed: false,
          score: 0,
          reason: `Frame ${i + 1} is missing or empty`,
        };
      }
    }

    // Demo mode: All validations passed -> return success
    // In production: would call ML API to compare faces
    console.log("[verifyFaceMatch] PASS: All frames valid");
    return {
      success: true,
      passed: true,
      score: 0.85,
      reason: "Face match verified",
    };
  },
});

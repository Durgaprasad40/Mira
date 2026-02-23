# Mira Verification System - Comprehensive Audit Report

**Date:** 2026-02-21
**Branch:** feature/soft-verification-audit
**Auditor:** Claude Code

---

## Executive Summary

The Mira app has a partially implemented verification system with ML Kit face detection, blink-based liveness checks, trust scoring, and admin review capabilities. However, the current implementation lacks the "soft verification" state machine and several key features required for the Phase-1 soft verification policy.

---

## 1. Current Implementation Analysis

### 1.1 Mobile ML Kit Integration

**Files:**
- `modules/mira-face-detector/` - Custom Expo local module
- `app/(onboarding)/blink-verification.tsx` - Liveness verification screen (874 lines)
- `app/(onboarding)/face-verification.tsx` - Static selfie capture (403 lines)

**What Works:**
- ML Kit Face Detection integrated on both iOS and Android
- Returns: `hasFace`, `facesCount`, `bounds`, `yaw/pitch/roll`, `leftEyeOpenProb`, `rightEyeOpenProb`, `smilingProb`
- Blink detection with eye open/closed thresholds (0.3 closed, 0.7 open)
- 5-1 countdown that pauses if face leaves frame
- Local heuristic photo similarity check (face position/size consistency)
- No video storage - frames processed in-memory and discarded
- Mandatory step (no skip button)

**Gaps:**
- [ ] ML Kit result summary not uploaded to backend
- [ ] No head-turn detection implemented (only blink)
- [ ] No "best frame" extraction for manual review
- [ ] `blinkVerificationPassed` stored in local Zustand only, not synced to Convex

### 1.2 Backend Verification System

**Files:**
- `convex/verification.ts` (688 lines) - Core verification logic
- `convex/schema.ts` (lines 188-230, 589-606) - User & session schemas
- `convex/trustScore.ts` (128 lines) - Trust score computation

**Current Schema (users table):**
```typescript
verificationStatus: v.optional(v.union(
  v.literal('unverified'),
  v.literal('pending_verification'), // Legacy
  v.literal('pending_auto'),         // Awaiting auto-check
  v.literal('pending_manual'),       // Needs human review
  v.literal('verified'),
  v.literal('rejected')
)),
photoVerificationReason: v.optional(v.union(
  v.literal('no_face_detected'),
  v.literal('multiple_faces'),
  v.literal('blurry'),
  v.literal('suspected_fake'),
  v.literal('nsfw_content'),
  v.literal('low_quality'),
  v.literal('suspicious_ai_generated'),
  v.literal('manual_review_required')
)),
trustScore: v.optional(v.number()),
trustScoreUpdatedAt: v.optional(v.number()),
verificationEnforcementLevel: v.optional(v.union(
  v.literal('none'),
  v.literal('gentle'),
  v.literal('security_only'),
  v.literal('full_lockdown')
)),
```

**Current verificationSessions table:**
```typescript
verificationSessions: defineTable({
  userId: v.id('users'),
  selfieStorageId: v.id('_storage'),
  status: v.union(
    v.literal('pending'),
    v.literal('approved'),
    v.literal('rejected'),
    v.literal('expired')
  ),
  rejectionReason: v.optional(v.string()),
  selfieMetadata: v.optional(v.object({
    hasFace: v.optional(v.boolean()),
    facesCount: v.optional(v.number()),
    faceConfidence: v.optional(v.number()),
    blurScore: v.optional(v.number()),
    quality: v.optional(v.string()),
  })),
  reviewedBy: v.optional(v.string()),
  reviewedAt: v.optional(v.number()),
  createdAt: v.number(),
  expiresAt: v.number(),
})
```

**What Works:**
- `createVerificationSession` - Creates session with selfie storage ID
- `processPhotoVerification` - Auto-verification based on face detection
- `getPendingManualReviews` - Admin query (requires admin token)
- `adminReviewVerification` - Admin approve/reject with audit logging
- `cleanupOldVerificationPhotos` - Cron deletes photos >90 days old
- `canUserInteract` - Blocks unverified users from matching/chatting

**Gaps:**
- [ ] No `SOFT_VERIFIED` state
- [ ] No `FLAGGED` state
- [ ] No `REVERIFY_REQUIRED` state
- [ ] No `BLOCKED` state (separate from `rejected`)
- [ ] Missing ML Kit result summary field in verificationSessions
- [ ] No 48-hour SLA tracking for manual reviews
- [ ] No "reduced visibility" logic for `pending_manual` users

### 1.3 Trust Score System

**File:** `convex/trustScore.ts`

**Current Algorithm:**
```
Base: 50 points
+ 20 if verificationStatus === 'verified'
+ 10 if verificationStatus === 'pending_verification'
+ 5 if emailVerified
+ 5 if account age >= 30 days
+ 5 if >= 3 face photos
+ 5 if bio > 100 chars
+ 5 if >= 2 profile prompts

- 15 if isMultiAccountFlagged
- 10 if >= 3 distinct reporters
- 10 per high-severity behavior flag
- 5 per medium-severity behavior flag
- 5 if any NSFW photos

Auto-actions:
- If score < 30: Create 'suspicious_profile' behavior flag
- If score < 15: Force verificationEnforcementLevel = 'security_only'
```

**Gaps:**
- [ ] No trust score adjustment for soft verification pass/fail
- [ ] No weighting for liveness check (blink/head-turn)
- [ ] Trust score not used in discovery ranking

### 1.4 Admin Review UI

**File:** `app/(main)/admin/verification.tsx` (676 lines)

**What Works:**
- List pending manual reviews with photos
- Approve/Reject with reason selection
- Optimistic UI updates
- Demo mode support

**Gaps:**
- [ ] No 48-hour SLA warning indicators
- [ ] No ML Kit metadata display (eye probs, yaw/pitch)
- [ ] No comparison view (verification selfie vs profile photos)
- [ ] No flag history / trust score display

### 1.5 Device Fingerprinting & Abuse Detection

**Files:**
- `convex/deviceFingerprint.ts` (157 lines)
- `convex/behaviorDetection.ts` (168 lines)

**What Works:**
- Device fingerprint registration (deviceId, installId, platform)
- Multi-account detection (flags both accounts)
- Rapid swiping detection (>100 in 5 mins)
- Mass messaging detection (>20 identical messages/hour)
- Report threshold tracking (>=3 distinct reporters)

**Current behaviorFlags types:**
- `rapid_swiping`
- `mass_messaging`
- `rapid_account_creation`
- `reported_by_multiple`
- `suspicious_profile`

**Gaps:**
- [ ] No rate counters for verification attempts
- [ ] No IP-based suspicious activity tracking
- [ ] No pattern matching for known abuse vectors

### 1.6 OTP / Phone Verification

**File:** `convex/auth.ts` (1602 lines)

**What Works:**
- `sendOTP` - Generates 6-digit OTP, stores in otpCodes table
- `verifyOTP` - Validates with brute-force protection (5 attempts, 15min lockout)
- OTP expiry: 10 minutes
- Rate limiting: 60 seconds between resends

**Gaps:**
- [ ] Phone number uniqueness not enforced at signup
- [ ] No phone verification status field on user
- [ ] OTP currently not sent (TODO comment for Twilio/SendGrid integration)

---

## 2. Required State Machine (Per Policy)

```
UNVERIFIED
    │
    ▼ (completes ML Kit verification)
SOFT_VERIFIED ◄─────────────────────────────┐
    │                                        │
    │ (high-risk flag triggered)             │
    ▼                                        │
FLAGGED                                      │
    │                                        │
    │ (auto-escalation or admin action)      │
    ▼                                        │
MANUAL_REVIEW ──────────────────────────────►│ (approved)
    │
    │ (rejected or blocked)
    ▼
BLOCKED / REVERIFY_REQUIRED
```

### State Definitions

| State | Visibility | Features | Notes |
|-------|-----------|----------|-------|
| `UNVERIFIED` | Zero (hidden from all users) | Cannot match/chat | Must complete OTP + ML Kit |
| `SOFT_VERIFIED` | Full | All features | Passed ML Kit liveness |
| `FLAGGED` | Reduced (50% ranking weight) | Limited features | Awaiting auto-triage |
| `MANUAL_REVIEW` | Low (25% ranking weight) | Cannot initiate chats | 48-hour SLA |
| `BLOCKED` | Zero | Locked out | Admin decision |
| `REVERIFY_REQUIRED` | Zero | Must redo ML Kit | Failed review |

---

## 3. Implementation Plan

### Phase 1A: Schema Updates

**File: `convex/schema.ts`**

1. Update `verificationStatus` enum:
```typescript
verificationStatus: v.optional(v.union(
  v.literal('unverified'),
  v.literal('soft_verified'),      // NEW
  v.literal('flagged'),            // NEW
  v.literal('manual_review'),      // Renamed from pending_manual
  v.literal('blocked'),            // NEW
  v.literal('reverify_required'),  // NEW
  // Legacy states for migration
  v.literal('pending_verification'),
  v.literal('pending_auto'),
  v.literal('pending_manual'),
  v.literal('verified'),
  v.literal('rejected'),
)),
```

2. Add phone verification fields:
```typescript
phoneVerified: v.optional(v.boolean()),
phoneVerifiedAt: v.optional(v.number()),
```

3. Add ML Kit result fields to verificationSessions:
```typescript
mlKitSummary: v.optional(v.object({
  livenessCheckType: v.union(v.literal('blink'), v.literal('head_turn')),
  blinkDetected: v.optional(v.boolean()),
  headTurnDetected: v.optional(v.boolean()),
  leftEyeOpenProb: v.optional(v.number()),
  rightEyeOpenProb: v.optional(v.number()),
  yaw: v.optional(v.number()),
  pitch: v.optional(v.number()),
  roll: v.optional(v.number()),
  faceConsistencyScore: v.optional(v.number()),
  frameCount: v.optional(v.number()),
  capturedAt: v.number(),
})),
slaDeadline: v.optional(v.number()),  // 48-hour deadline
```

4. Add verification rate limiting table:
```typescript
verificationAttempts: defineTable({
  userId: v.id('users'),
  attemptedAt: v.number(),
  result: v.union(v.literal('success'), v.literal('failure')),
  failureReason: v.optional(v.string()),
  deviceId: v.optional(v.string()),
})
  .index('by_user', ['userId'])
  .index('by_user_time', ['userId', 'attemptedAt']),
```

### Phase 1B: Backend Mutations

**File: `convex/verification.ts`** (new/modified functions)

1. `submitLivenessResult` - Called from mobile after blink verification
2. `transitionVerificationState` - State machine transitions with validation
3. `checkVerificationRateLimit` - Max 3 attempts per hour
4. `escalateToManualReview` - Move to manual_review with 48h SLA
5. `getUserVisibilityWeight` - Returns 0, 0.25, 0.5, or 1.0 based on state

### Phase 1C: Trust Score Updates

**File: `convex/trustScore.ts`**

Add:
```typescript
// Soft verification passed
if (user.verificationStatus === 'soft_verified') score += 25;
// In manual review (penalty)
if (user.verificationStatus === 'manual_review') score -= 10;
// Flagged
if (user.verificationStatus === 'flagged') score -= 5;
```

### Phase 1D: Mobile Integration

**File: `app/(onboarding)/blink-verification.tsx`**

Add after successful blink detection:
```typescript
// Call backend to submit ML Kit results
await convex.mutation(api.verification.submitLivenessResult, {
  userId,
  livenessCheckType: 'blink',
  blinkDetected: true,
  leftEyeOpenProb: lastFace.leftEyeOpenProb,
  rightEyeOpenProb: lastFace.rightEyeOpenProb,
  yaw: lastFace.yaw,
  pitch: lastFace.pitch,
  roll: lastFace.roll,
  faceConsistencyScore: consistentFrames / totalFrames,
  frameCount: faceSnapshotsRef.current.length,
});
```

### Phase 1E: Discovery/Ranking Updates

**File: `convex/discover.ts`**

Modify scoring to use visibility weight:
```typescript
const visibilityWeight = await getVisibilityWeight(ctx, userId);
if (visibilityWeight === 0) continue; // Skip hidden users
finalScore *= visibilityWeight;
```

---

## 4. Files to Modify (Summary)

| File | Changes |
|------|---------|
| `convex/schema.ts` | Add new states, ML Kit fields, rate limit table |
| `convex/verification.ts` | State machine, rate limiting, visibility weight |
| `convex/trustScore.ts` | Add soft_verified scoring |
| `convex/discover.ts` | Apply visibility weight to ranking |
| `convex/likes.ts` | Update interaction checks |
| `convex/messages.ts` | Update chat restrictions |
| `app/(onboarding)/blink-verification.tsx` | Submit ML Kit results to backend |
| `stores/onboardingStore.ts` | Remove local blinkVerificationPassed (use backend) |
| `app/(main)/admin/verification.tsx` | Add SLA indicators, ML Kit display |

---

## 5. Migration Strategy

For existing users:
- `verified` → `soft_verified`
- `pending_manual` → `manual_review`
- `rejected` → `blocked`
- `pending_verification` / `pending_auto` → `unverified`

Migration mutation:
```typescript
export const migrateVerificationStates = mutation({
  handler: async (ctx) => {
    const users = await ctx.db.query('users').collect();
    for (const user of users) {
      const oldStatus = user.verificationStatus;
      const newStatus = {
        'verified': 'soft_verified',
        'pending_manual': 'manual_review',
        'rejected': 'blocked',
        'pending_verification': 'unverified',
        'pending_auto': 'unverified',
      }[oldStatus] || oldStatus;

      if (newStatus !== oldStatus) {
        await ctx.db.patch(user._id, { verificationStatus: newStatus });
      }
    }
  },
});
```

---

## 6. Testing Checklist

- [ ] New user completes OTP + blink verification → becomes `soft_verified`
- [ ] Unverified user hidden from all discover results
- [ ] Flagged user has 50% visibility weight
- [ ] Manual review user has 25% visibility weight
- [ ] Admin can approve manual_review → soft_verified
- [ ] Admin can reject → blocked
- [ ] Blocked user cannot log in (or sees blocked screen)
- [ ] reverify_required user redirected to blink verification
- [ ] Rate limit: >3 failed verification attempts in 1 hour → blocked
- [ ] Trust score updates correctly for each state
- [ ] 48-hour SLA tracked and displayed in admin UI

---

## 7. Security Considerations

1. **No video storage** - Frames processed in-memory only
2. **Rate limiting** - Max 3 verification attempts per hour
3. **Device fingerprinting** - Multi-account detection
4. **Admin audit logging** - All review actions logged
5. **48-hour photo retention** for manual review, then deleted
6. **ML Kit runs on-device** - No face data sent to third parties

---

## 8. Out of Scope (Phase 2)

- AWS Rekognition integration for advanced face matching
- Video liveness (multiple frames sent to server)
- Government ID verification
- Verified badge UI element
- Push notifications for verification status changes

---

## Approval Required

Before implementing, please confirm:

1. State machine transitions (diagram above)
2. Visibility weights (0%, 25%, 50%, 100%)
3. Trust score adjustments (+25 for soft_verified, -10 for manual_review, -5 for flagged)
4. Rate limit: 3 attempts per hour
5. SLA: 48 hours for manual review
6. Migration strategy for existing users

**Awaiting user approval to proceed with implementation.**

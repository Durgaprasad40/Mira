# Onboarding Stability Report

**Date:** 2026-02-23 17:30 IST
**Branch:** `feat/mlkit-3frame-verify`
**Commit:** `6647e84 fix(onboarding): always show editable email on password screen`
**Device:** Android (3fba464a)
**Metro:** Running on port 8081

---

## A) PASS Checks

| Check | Status | Notes |
|-------|--------|-------|
| Boot routing to welcome | ✅ PASS | `[ONB] route_decision routeDestination=/(auth)/welcome` |
| Metro connection | ✅ PASS | After `adb reverse tcp:8081 tcp:8081` |
| Store hydration | ✅ PASS | authStore: 1621ms, onboardingStore: 1242ms |
| Boot cache system | ✅ PASS | `[DURATION] boot_caches: 16ms` |
| DOB off-by-one fix | ✅ PASS | `parseDOBString()` + `formatDOBToString()` implemented |

---

## B) Issues Found

### Issue #1: DEMO MODE NOT ENABLED (BLOCKER)

**Severity:** BLOCKER
**Symptom:** User expects "Verified (Demo)" but will see "Profile Under Review" because demo mode is OFF.

**Evidence:**
```
# .env.local
EXPO_PUBLIC_DEMO_MODE=false   ← Should be "true" for demo testing
```

**Impact:**
- Face verification uses `manual_review` mode instead of `demo_auto`
- User won't see "Verified (Demo)" message
- User will be stuck waiting for admin approval (which doesn't exist in demo)

**Minimal Fix:**
```bash
# Change in .env.local:
EXPO_PUBLIC_DEMO_MODE=true
```

**File:** `.env.local` (line 10)

---

### Issue #2: App Stuck on Logo Without ADB Reverse (HIGH)

**Severity:** HIGH
**Symptom:** App stuck on splash screen, JS bundle never loads.

**Evidence:**
```
ReactNative: The packager does not seem to be running as we got an
IOException requesting its status: Failed to connect to localhost/127.0.0.1:8081
```

**Root Cause:** Dev-client configured to connect to localhost:8081, but Metro runs on Mac's LAN IP.

**Minimal Fix:** Always run before testing:
```bash
adb reverse tcp:8081 tcp:8081
```

**File:** N/A (environment setup, not code)

---

### Issue #3: Force Logout on Incomplete Onboarding (MEDIUM - Expected Behavior)

**Severity:** MEDIUM (but may be intentional)
**Symptom:** User with token but `faceVerificationPassed=false` is forced to logout.

**Evidence:**
```
[ONB] boot_decision facePassed=false onboardingCompleted=false hasToken=true action=FORCE_WELCOME_LOGOUT
[ONB] pre-verify → forcing logout, routing to /(auth)/welcome
```

**Analysis:** This is the checkpoint system working as designed. Users who didn't complete face verification are forced to start over. This prevents users from being stuck in a broken state.

**Recommendation:** Consider allowing users to RESUME onboarding from where they left off instead of forcing full restart. However, this is a design decision, not a bug.

**File:** `app/index.tsx:105-110`

---

### Issue #4: Expo AV Deprecation Warning (LOW)

**Severity:** LOW
**Symptom:** Console warning on every app launch.

**Evidence:**
```
[expo-av]: Expo AV has been deprecated and will be removed in SDK 54.
Use the `expo-audio` and `expo-video` packages to replace the required functionality.
```

**Impact:** No functional impact now, but will break in SDK 54.

**Minimal Fix:** Migrate to `expo-audio` and `expo-video` when upgrading SDK (not urgent).

**File:** Dependencies in `package.json`

---

## C) Severity Summary

| Severity | Count | Issues |
|----------|-------|--------|
| BLOCKER | 1 | Demo mode not enabled |
| HIGH | 1 | ADB reverse required |
| MEDIUM | 1 | Force logout behavior (intentional?) |
| LOW | 1 | Expo AV deprecation warning |

---

## D) Minimal Fixes (Onboarding-Only)

### Fix 1: Enable Demo Mode (IMMEDIATE)
```bash
# Edit .env.local line 10:
# BEFORE:
EXPO_PUBLIC_DEMO_MODE=false
# AFTER:
EXPO_PUBLIC_DEMO_MODE=true
```

### Fix 2: ADB Reverse Setup Script
Add to testing workflow (not code change):
```bash
# Always run before testing:
adb reverse tcp:8081 tcp:8081
```

### Fix 3: (OPTIONAL) Resume Onboarding Instead of Force Logout
If desired, modify `app/index.tsx` lines 105-130 to:
- Check which onboarding step user was on
- Navigate to that step instead of forcing logout
- **Risk:** Medium (requires careful state management)
- **Recommendation:** Defer to after stability testing

---

## Next Action List (Max 5)

1. **[IMMEDIATE]** Change `.env.local` → `EXPO_PUBLIC_DEMO_MODE=true`
2. **[IMMEDIATE]** Run `adb reverse tcp:8081 tcp:8081` before testing
3. **[TEST]** Restart Metro with `--clear`, relaunch app, verify "Verified (Demo)" appears
4. **[TEST]** Complete full onboarding flow: email → password → basic-info → photo → face verification
5. **[DEFER]** Consider onboarding resume feature (post-stability)

---

## Files That Would Change (Code Fixes)

| File | Change | Status |
|------|--------|--------|
| `.env.local` | Set `EXPO_PUBLIC_DEMO_MODE=true` | RECOMMENDED |
| `app/index.tsx` | (Optional) Resume onboarding | DEFERRED |

**No code changes to onboarding screens are needed at this time.**

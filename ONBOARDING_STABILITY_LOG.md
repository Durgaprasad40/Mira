# Onboarding Stability Log

## Session Info
- **Date/Time**: 2026-02-23 16:55 IST
- **Device**: Android (ID: 3fba464a)
- **Branch**: `feat/mlkit-3frame-verify`
- **Last Commit**: `6647e84 fix(onboarding): always show editable email on password screen`

## Scope

### IN SCOPE
- App boot to onboarding
- Basic Info (DOB must not shift; age correct)
- Consent / review screens in onboarding
- Profile photo upload
- Additional/multiple photo uploads
- Face verification (Demo auto-approve should show "Verified (Demo)" and continue)
- Stop once onboarding reaches the screen AFTER photo verification / additional photos step

### OUT OF SCOPE
- Phase 1 main app (app/(main)/* except crash blockers)
- Phase 2 private mode
- Any locked UI/keyboard behavior changes
- Non-onboarding features

---

## Test Passes

### Pass #1
| Step | Status | Notes |
|------|--------|-------|
| App boot | - | - |
| Basic Info screen | - | - |
| DOB Test #1 (mid-month) | - | - |
| DOB Test #2 (1st of month) | - | - |
| DOB Test #3 (31st/end of month) | - | - |
| Consent screen | - | - |
| Review screen | - | - |
| Profile photo upload | - | - |
| Additional photos (2+) | - | - |
| Face verification | - | - |
| "Verified (Demo)" shown | - | - |
| Continue to next screen | - | - |
| End checkpoint reached | - | - |

### Pass #2
| Step | Status | Notes |
|------|--------|-------|
| (To be filled after Pass #1) | - | - |

### Pass #3 (Force-close test)
| Step | Status | Notes |
|------|--------|-------|
| (To be filled after Pass #2) | - | - |

---

## Issues Found

### Issue #1: App stuck on logo (FIXED)
- **Symptom**: App stuck on splash/logo screen, never progressed to JS
- **Root Cause**: Dev-client trying to connect to `localhost:8081` but Metro running on Mac's LAN IP. Device couldn't reach Metro.
- **Log Evidence**: `ReactNative: The packager does not seem to be running as we got an IOException requesting its status: Failed to connect to localhost/127.0.0.1:8081`
- **Fix**: Run `adb reverse tcp:8081 tcp:8081` to forward device's localhost:8081 to Mac's localhost:8081
- **Risk**: Low (dev environment only, not a code change)
- **Status**: FIXED

---

## Fixes Applied

(To be populated after analysis)

---

## Files Changed

(To be populated after fixes)

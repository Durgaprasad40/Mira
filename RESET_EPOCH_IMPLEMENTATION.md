# Reset Epoch Implementation

## Summary

Fixed the bug where the app showed stale data (old profiles, demo users, messages) after running `resetAllUsers`. Implemented a reset epoch mechanism that detects when the backend database has been reset and automatically clears local persisted storage.

## Problem

After running `npx convex run admin:resetAllUsers '{"dryRun": false}'` to delete all users from the Convex backend, the app still displayed:
- Old Phase-2 profile (e.g., Manmohan, 26)
- Demo users and demo messages
- Cached onboarding status showing onboardingCompleted=true
- Old chat room messages and memberships

This was caused by persisted local storage (AsyncStorage + Zustand persist) not being cleared when the backend was reset.

## Solution

Implemented a reset epoch mechanism with the following components:

### 1. Backend Changes

#### A. Added `systemConfig` table to schema (`convex/schema.ts`)
```typescript
systemConfig: defineTable({
  key: v.string(),  // e.g., "resetEpoch"
  value: v.any(),   // Flexible value (number, string, boolean, object)
  updatedAt: v.number(),
})
  .index('by_key', ['key']),
```

#### B. Created `convex/system.ts` with queries/mutations
- `getResetEpoch` - Query to fetch current reset epoch (returns 0 if not set)
- `bumpResetEpoch` - Internal mutation to increment reset epoch

#### C. Updated `convex/admin.ts`
- Modified `resetAllUsers` to call `bumpResetEpoch` after deleting users
- Bumped epoch signals to clients that database was reset
- Returns new `resetEpoch` in response

### 2. Frontend Changes

#### A. Created `lib/resetEpochCheck.ts`
Utility module with functions:
- `getLocalResetEpoch()` - Read local epoch from AsyncStorage
- `setLocalResetEpoch(epoch)` - Store local epoch
- `clearAllPersistedData()` - Clear all persisted stores
- `purgeDemoStoresIfDisabled()` - Remove demo stores when demo mode is off
- `checkAndHandleResetEpoch(serverEpoch)` - Main check logic

**Persisted stores cleared:**
- `auth-storage` - Auth tokens, user ID
- `onboarding-storage` - Onboarding progress
- `demo-storage` - Demo user data
- `demo-dm-storage` - Demo messages
- `demo-chatroom-storage` - Demo chat rooms
- `photo-blur-storage` - Photo privacy settings
- `privacy-storage` - Privacy preferences
- `verification-storage` - Face verification status
- `private-profile-storage` - Private profile data
- `chat-room-session-storage` - Chat room visit tracking
- `chat-room-profile-storage` - Chat room profiles cache
- `chat-room-dm-storage` - Chat room DMs
- `private-chat-storage` - Private chats
- `preferred-chat-room-storage` - Preferred room
- `discover-storage` - Discovery queue
- `filter-storage` - Filter preferences
- `subscription-storage` - Subscription status
- `confession-storage` - Confessions
- `confess-preview-storage` - Confession previews
- `location-storage` - Location data
- `incognito-storage` - Incognito mode state
- `tod-identity-storage` - Truth or Dare identity
- `media-view-storage` - Media viewing state
- `block-storage` - Blocked users
- `interaction-storage` - User interactions
- `chat-tod-storage` - Chat Truth or Dare games
- `auth-boot-cache` - Auth boot cache
- `boot-cache` - Boot cache

#### B. Added `ResetEpochChecker` component to `app/_layout.tsx`
- Runs early in boot sequence (after ConvexProvider, before BootStateTracker)
- Fetches server resetEpoch via `useQuery(api.system.getResetEpoch)`
- Compares with local resetEpoch
- If mismatch:
  - Clears all persisted stores
  - Calls `logout()`, `resetOnboarding()`, `demoLogout()`
  - Updates local epoch to match server
  - Forces navigation to `/` (welcome screen)
  - Logs: `[RESET_EPOCH] mismatch detected -> purging local caches -> done`

### 3. Demo Mode Guards

Added hard guard to prevent demo stores from hydrating when `EXPO_PUBLIC_DEMO_MODE=false`:
- `purgeDemoStoresIfDisabled()` runs on every app launch
- Removes `demo-storage`, `demo-dm-storage`, `demo-chatroom-storage` keys
- Logs: `[RESET_EPOCH] Demo mode disabled - purging demo stores...`

## Files Changed

### Backend Files

1. **convex/schema.ts**
   - Added `systemConfig` table with `key`, `value`, `updatedAt` fields
   - Indexed by `key` for fast lookups

2. **convex/system.ts** (NEW)
   - Created `getResetEpoch` query
   - Created `bumpResetEpoch` internal mutation
   - Handles creation and updates of resetEpoch config

3. **convex/admin.ts**
   - Imported `internal` API
   - Updated `resetAllUsers` to call `bumpResetEpoch` after deletion
   - Added logging: `[RESET_EPOCH] Bumping reset epoch...`
   - Returns `resetEpoch` in response

### Frontend Files

4. **lib/resetEpochCheck.ts** (NEW)
   - Complete reset epoch check and cache clearing logic
   - Defines all persisted store keys to clear
   - Implements demo mode purge
   - Extensive logging for debugging

5. **app/_layout.tsx**
   - Imported `checkAndHandleResetEpoch`
   - Added `ResetEpochChecker` component
   - Integrated into RootLayout component tree
   - Runs early in boot sequence

## How It Works

### Flow Diagram

```
1. Admin runs: resetAllUsers
   ↓
2. Backend deletes all users
   ↓
3. Backend bumps resetEpoch (0 → 1)
   ↓
4. User reopens app
   ↓
5. ResetEpochChecker fetches server epoch = 1
   ↓
6. Reads local epoch = 0
   ↓
7. Detects mismatch (1 ≠ 0)
   ↓
8. Clears all 30+ persisted store keys
   ↓
9. Calls logout(), resetOnboarding(), demoLogout()
   ↓
10. Sets local epoch = 1
   ↓
11. Navigates to welcome screen (/)
   ↓
12. App starts fresh with empty backend
```

### Logging Output

When reset is detected:
```
[RESET_EPOCH] Checking reset epoch...
[RESET_EPOCH] Server epoch: 1
[RESET_EPOCH] Local epoch: 0
[RESET_EPOCH] ⚠️  MISMATCH DETECTED - Database was reset!
[RESET_EPOCH] Clearing all local caches to prevent stale data...
[RESET_EPOCH] Clearing all persisted stores...
[RESET_EPOCH] Cleared: auth-storage
[RESET_EPOCH] Cleared: onboarding-storage
[RESET_EPOCH] Cleared: demo-storage
... (30+ more lines)
[RESET_EPOCH] All persisted stores cleared
[RESET_EPOCH] Local epoch updated to 1
[RESET_EPOCH] ✅ Cache clearing complete. App will start fresh.
[RESET_EPOCH] Database reset detected - forcing logout...
[RESET_EPOCH] Navigating to welcome screen...
```

When no reset detected:
```
[RESET_EPOCH] Checking reset epoch...
[RESET_EPOCH] Server epoch: 1
[RESET_EPOCH] Local epoch: 1
[RESET_EPOCH] ✅ Epochs match - no cache clearing needed
```

## Manual Test Checklist

### Test 1: Reset Detection
- [ ] Run `npx convex run admin:resetAllUsers '{"dryRun": false}'`
- [ ] Verify logs show: `[RESET_EPOCH] Bumping reset epoch...`
- [ ] Verify logs show new epoch number
- [ ] Force close app completely

### Test 2: Cache Clearing
- [ ] Reopen app
- [ ] Check logs for: `[RESET_EPOCH] ⚠️  MISMATCH DETECTED`
- [ ] Verify logs show clearing of all persisted stores
- [ ] Verify logs show: `[RESET_EPOCH] Local epoch updated to X`
- [ ] Verify logs show: `[RESET_EPOCH] Navigating to welcome screen...`

### Test 3: Clean State Verification
- [ ] Verify NO old user profile shows (no Manmohan, no demo users)
- [ ] Verify NO demo messages appear
- [ ] Verify onboarding starts from beginning
- [ ] Verify chat rooms list is preserved (Global, Hindi, Telugu, etc.)
- [ ] Verify NO old chat room messages show
- [ ] Verify NO old memberships/notifications

### Test 4: Demo Mode Purge
- [ ] Verify `EXPO_PUBLIC_DEMO_MODE=false` in env
- [ ] Verify logs show: `[RESET_EPOCH] Demo mode disabled - purging demo stores...`
- [ ] Verify no demo data hydrates into UI

### Test 5: Subsequent Launches
- [ ] Close and reopen app again
- [ ] Verify logs show: `[RESET_EPOCH] ✅ Epochs match - no cache clearing needed`
- [ ] Verify no cache clearing happens (faster boot)

## TypeScript Compilation

✅ **PASSED** - No TypeScript errors in modified files:
- convex/schema.ts
- convex/system.ts
- convex/admin.ts
- lib/resetEpochCheck.ts
- app/_layout.tsx

## Features Preserved

✅ All core features remain unchanged:
- Chat rooms (Global, Hindi, Telugu, etc.) preserved
- System configs preserved
- Prompt seeds preserved
- No UI changes
- No feature modifications
- All locks respected

## Security & Safety

✅ Safety measures:
- Only clears CLIENT-SIDE data (AsyncStorage)
- NEVER modifies Convex backend data
- Backend remains source of truth
- Idempotent (safe to run multiple times)
- Demo stores only purged when demo mode disabled
- Hard guards prevent demo data leaking into live mode

## Future Improvements

1. Add UI indicator when reset is detected (optional toast/alert)
2. Add analytics tracking for reset events
3. Add admin UI to view current resetEpoch
4. Add ability to manually trigger cache clear without backend reset
5. Consider selective clearing (clear only user data, keep app preferences)

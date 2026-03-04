# Storage Policy Implementation - NO Local User Data Persistence

## Summary

This document tracks the implementation of the strict "no local user data persistence" policy. ALL user information must be stored ONLY in Convex, with local state being ephemeral (in-memory only).

## Goal

- **NO** user information persisted on-device (AsyncStorage/MMKV/SecureStore/local files)
- Convex is the ONLY source of truth for all user information and user-generated content
- Local device data exists ONLY as ephemeral runtime state (in-memory) and temporary upload buffers
- Data must not survive app restart - rehydrate from Convex on app boot
- Passwords must NEVER be stored anywhere (not Convex, not locally)

## Scope of "User Information"

Email, phone, name, nickname, DOB, gender, onboarding progress/drafts, preferences, lifestyle, filters, privacy settings, verification states, chats, notifications, memberships, metadata, photos/media references.

---

## FILES CHANGED

### ✅ COMPLETED: Core Auth & Onboarding Stores (4 files)

#### 1. `stores/authStore.ts` - ✅ DONE
**Changes:**
- Removed `persist` middleware and `AsyncStorage` imports
- Removed `createJSONStorage` usage
- Set `_hasHydrated` to always `true` (no async hydration)
- Removed hydration timeout logic
- Kept all action methods unchanged for compatibility
- Added storage policy comment header

**Pattern applied:**
```typescript
// BEFORE
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({ ...state, _hasHydrated: false }),
    { name: "auth-storage", storage: createJSONStorage(() => AsyncStorage) }
  )
);

// AFTER
import { create } from "zustand";
// STORAGE POLICY: NO local persistence, Convex is source of truth

export const useAuthStore = create<AuthState>()((set) => ({
  ...state,
  _hasHydrated: true, // Always true - no AsyncStorage
  setHasHydrated: (state) => set({ _hasHydrated: true }), // No-op for compatibility
}));
```

#### 2. `stores/authBootCache.ts` - ✅ DONE
**Changes:**
- Removed all AsyncStorage reads
- Returns default empty state immediately
- No longer caches auth data for fast routing
- Kept all function signatures for compatibility

#### 3. `stores/bootCache.ts` - ✅ DONE
**Changes:**
- Removed all AsyncStorage reads
- Returns default empty state immediately
- No longer caches demo mode data
- Kept all function signatures for compatibility

#### 4. `stores/onboardingStore.ts` - ✅ DONE (618 lines)
**Changes:**
- Removed `persist` middleware and `AsyncStorage` imports
- Removed `ONBOARDING_STORE_LOAD_TIME` constant
- Set `_hasHydrated` to always `true`
- Removed hydration timeout logic (`setupOnboardingHydrationTimeout`)
- Removed `onRehydrateStorage` callback
- Added storage policy comment header
- Kept all 50+ action methods unchanged (addPhoto, setEmail, setName, etc.)
- Photos array (`PhotoSlots9`) now truly ephemeral - no persistence

**Critical note:** This store contained email, phone, password, name, DOB, gender, photos (9 slots), bio, profile prompts, preferences, filters, etc. All now in-memory only.

#### 5. `stores/privacyStore.ts` - ✅ DONE
**Changes:**
- Removed `persist` middleware and `AsyncStorage`
- Set `_hasHydrated` to always `true`
- No longer persists: hideFromDiscover, hideAge, hideDistance, disableReadReceipts
- Kept all action methods unchanged

#### 6. `stores/verificationStore.ts` - ✅ DONE
**Changes:**
- Removed `persist` middleware and `AsyncStorage`
- Set `_hasHydrated` to always `true`
- No longer persists: faceStatus, faceVerifiedAt, kycStatus, kycVerifiedAt
- Kept all action methods unchanged

---

## ⏳ REMAINING WORK

### High Priority Stores (Need Same Pattern)

Apply the same refactoring pattern to these stores:

#### User Data & Preferences
- **`stores/filterStore.ts`** - Gender filters, age range, distance, relationship intent, activities, sort option
- **`stores/incognitoStore.ts`** - Private mode toggle, 18+ age confirmation timestamp
- **`stores/blockStore.ts`** - Blocked user IDs and block timestamps
- **`stores/photoBlurStore.ts`** - Per-user blur settings, blurred photo indices

#### Discovery & Matching
- **`stores/discoverStore.ts`** - Daily like/standout counts, swipe count, profile view count, random match state
- **`stores/subscriptionStore.ts`** - Subscription tier, trial/expiry dates, feature limits

#### Chat & Messaging
- **`stores/privateChatStore.ts`** - Unlocked users, conversations, messages (keyed by conversationId), pending dares
- **`stores/chatRoomSessionStore.ts`** - Active room session, user identity snapshot, coins from messages
- **`stores/chatRoomProfileStore.ts`** - Chat room profile caching
- **`stores/chatRoomDmStore.ts`** - Chat room DM data
- **`stores/chatTodStore.ts`** - Truth-or-Dare game state per conversation (skip count, prompt type, answers)
- **`stores/preferredChatRoomStore.ts`** - Preferred chat room ID for auto-navigation

#### Media & UI State
- **`stores/mediaViewStore.ts`** - Viewed media IDs, consumed "view once" media IDs (max 2000 with auto-eviction)
- **`stores/interactionStore.ts`** - Interaction tracking data
- **`stores/todIdentityStore.ts`** - Truth-or-Dare identity data

#### Confessions & Public Features
- **`stores/confessionStore.ts`** - Confessions, reactions, replies, chats, secret crushes (rate limit: 5/24hrs)
- **`stores/confessPreviewStore.ts`** - Confession preview data

#### Phase-2 Profile
- **`stores/privateProfileStore.ts`** - Phase-2 profile (username, bio, desire categories, blurred photos, consent)

### Demo Mode Stores (Optional - Can Keep or Remove)

These are for demo/testing only, not real user data:
- **`stores/demoStore.ts`** - Demo profiles, matches, likes, crossed paths, currentDemoUserId
- **`stores/demoDmStore.ts`** - Demo DM conversations and messages
- **`stores/demoChatRoomStore.ts`** - Demo chat room messages per room

**Recommendation:** Either remove persistence from these too (for consistency), OR clearly mark them as "demo-only" exceptions.

### Low Priority (System/Non-User Data)

- **`stores/locationStore.ts`** - Already NOT persisted (runtime GPS only) ✅
- **`stores/bootStore.ts`** - Boot cache utility

---

## DIRECT ASYNCSTORAGE USAGE (Must Remove or Justify)

These components use AsyncStorage directly outside of Zustand stores:

### 🔴 HIGH PRIORITY - User Data Persistence

#### 1. **Camera Capture Handoff** - `app/(main)/camera-composer.tsx` (lines 160-174)
**Keys:** `"tod_captured_media"`, `"tod_camera_answer_{todConversationId}"`
**Stores:** Media URI, type (photo/video), duration, visibility, isMirrored
**Action:** Remove persistence. Use in-memory state or Convex upload immediately.

#### 2. **Incognito Chat Media Handoff** - `app/(main)/incognito-chat.tsx` (lines 218, 221)
**Key:** `"secure_capture_media_{id}"`
**Stores:** Captured photo/video URI and metadata
**Action:** Remove persistence. Use in-memory state or Convex upload immediately.

#### 3. **T&D Camera Answer Handoff** - `components/truthdare/ChatTodOverlay.tsx` (lines 210, 214)
**Key:** `"tod_camera_answer_{conversationId}"`
**Stores:** Photo/video URI, duration, type
**Action:** Remove persistence. Use in-memory state or Convex upload immediately.

#### 4. **Chat Room Reports** - `app/(main)/(private)/(tabs)/chat-rooms/[roomId].tsx` (lines 970-990)
**Key:** `"chat_room_reports"`
**Stores:** Array of report entries with userId, reason, details, timestamp
**Action:** Move to Convex immediately. Reports should be in backend, not local storage.

### 🟡 MEDIUM PRIORITY - UI State (Arguably Not "User Information")

#### 5. **Nearby FAB Position** - `app/(main)/(tabs)/nearby.tsx` (lines 486, 524)
**Key:** `"nearby_fab_position"`
**Stores:** FAB x/y coordinates with bounds validation
**Action:** Consider removing (UI preference). OR mark as exception if not considered "user information".

#### 6. **Privacy Settings Warning** - `app/(main)/settings/privacy.tsx` (lines 35, 50)
**Key:** `"hide_discover_warning_shown"`
**Stores:** One-time warning flag for "Hide from Discover" toggle
**Action:** Remove. User can see warning every time or store in Convex if needed.

#### 7. **Chat Room Muting** - `app/(main)/(private)/(tabs)/chat-rooms/[roomId].tsx` (line 562)
**Key:** `"mute_room_{roomId}"`
**Stores:** Boolean mute flag
**Action:** Move to Convex (user preference).

#### 8. **Bottle Spin Game Skip Tracking** - `components/chat/BottleSpinGame.tsx` (lines 85, 98)
**Key:** `"bottle_spin_skip_{conversationId}_{userId}"`
**Stores:** Skip count, 24-hour reset timestamp
**Action:** Move to Convex (game state is user data).

### 🟢 LOW PRIORITY - System Data (Allowed Exceptions)

#### 9. **Device Fingerprint** - `lib/deviceFingerprint.ts` (lines 16, 19)
**Key:** `"mira_install_id"`
**Stores:** UUID generated once on first app install
**Action:** **ALLOWED EXCEPTION** - This is NOT user information, it's device identification for crash reports.

#### 10. **Reset Epoch Check** - `lib/resetEpochCheck.ts`
**Key:** `"mira:resetEpoch"`
**Stores:** Server reset epoch for detecting database resets
**Action:** **ALLOWED EXCEPTION** - System cache invalidation marker, not user data.

---

## REFACTORING PATTERN

For each persisted store:

### 1. Remove Imports
```typescript
// Remove these lines:
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
```

### 2. Add Storage Policy Comment
```typescript
// STORAGE POLICY ENFORCEMENT:
// This store contains [describe user data].
// NO local persistence. All data is ephemeral (in-memory only).
// Must be rehydrated from Convex on app boot. Convex is ONLY source of truth.
```

### 3. Remove persist() Wrapper
```typescript
// BEFORE
export const useMyStore = create<MyState>()(
  persist(
    (set) => ({ /* state */ }),
    { name: "my-storage", storage: createJSONStorage(() => AsyncStorage) }
  )
);

// AFTER
export const useMyStore = create<MyState>()((set) => ({
  /* state */
}));
```

### 4. Set _hasHydrated to Always True
```typescript
// BEFORE
_hasHydrated: false,
setHasHydrated: (state) => set({ _hasHydrated: state }),

// AFTER
_hasHydrated: true,
setHasHydrated: (state) => set({ _hasHydrated: true }),
```

### 5. Remove Hydration Timeout Logic
```typescript
// Remove all of this:
const STORE_LOAD_TIME = Date.now();
const HYDRATION_TIMEOUT_MS = 5000;
let _hydrationTimeoutId = ...;
function setupHydrationTimeout() { ... }
setupHydrationTimeout();

// Remove onRehydrateStorage callbacks
```

---

## CONVEX HYDRATION CHANGES

The app must rehydrate ALL user data from Convex on boot. Current hydration is in:

### `app/_layout.tsx` - OnboardingDraftHydrator Component (lines 440-551)

**Current behavior:**
- Queries `api.users.getOnboardingStatus` for onboarding data
- Hydrates basicInfo (name, nickname, DOB, gender) into onboardingStore
- Hydrates face verification flags
- Hydrates verification reference photo
- Hydrates onboarding draft if exists

**Required additions:**
1. **Privacy settings** - Query and hydrate privacyStore (hideFromDiscover, hideAge, hideDistance, disableReadReceipts)
2. **Verification statuses** - Query and hydrate verificationStore (faceStatus, kycStatus, timestamps)
3. **Filters** - Query and hydrate filterStore (age range, distance, gender filters, activities)
4. **Subscription** - Query and hydrate subscriptionStore (tier, limits, expiry)
5. **Block list** - Query and hydrate blockStore (blocked user IDs)
6. **Photo blur settings** - Query and hydrate photoBlurStore
7. **Chat conversations** - Query and hydrate privateChatStore
8. **Discovery state** - Query and hydrate discoverStore (like counts, swipe counts)

**Pattern:**
```typescript
// Example: Hydrate privacy settings
if (userProfile?.privacySettings) {
  const privacyStore = usePrivacyStore.getState();
  privacyStore.setHideFromDiscover(userProfile.privacySettings.hideFromDiscover);
  privacyStore.setHideAge(userProfile.privacySettings.hideAge);
  // ... etc
}
```

**Convex Queries Needed:**
- `api.users.getCurrentUser` - Already exists, may need to expand fields returned
- `api.privacy.getPrivacySettings` - Create new query
- `api.filters.getUserFilters` - Create new query
- `api.subscription.getSubscriptionStatus` - Create new query
- `api.blocks.getBlockedUsers` - Create new query
- `api.chats.getConversations` - Likely exists, expand if needed
- Etc.

---

## AUTH SCREENS - EMAIL/PHONE PRE-FILLING

### Remove Pre-filling in Auth Screens

**Files to check:**
- `app/(auth)/email-phone.tsx` - Email/phone entry screen
- `app/(auth)/otp.tsx` - OTP entry screen
- `app/(onboarding)/basic-info.tsx` - Name, DOB, gender entry

**Current behavior (suspected):**
- Email field may pre-fill from onboardingStore on mount
- Phone field may pre-fill from onboardingStore on mount

**Required changes:**
- Email field must start EMPTY (not pre-filled from store)
- Phone field must start EMPTY (not pre-filled from store)
- User must type email/phone fresh each time

**Pattern:**
```typescript
// BEFORE
const [email, setEmail] = useState(onboardingStore.email); // Pre-fills from store

// AFTER
const [email, setEmail] = useState(''); // Always empty on mount
```

---

## TYPESCRIPT COMPILATION

After all changes, verify TypeScript passes:

```bash
npx tsc --noEmit
```

Expected: 0 errors.

---

## VERIFICATION COMMANDS

### 1. Grep for Remaining AsyncStorage Usage
```bash
# Search for AsyncStorage setItem usage (user data writes)
grep -r "AsyncStorage.setItem" --include="*.ts" --include="*.tsx" app/ stores/ components/ lib/

# Search for persist middleware usage
grep -r "persist(" --include="*.ts" stores/

# Search for createJSONStorage usage
grep -r "createJSONStorage" --include="*.ts" stores/
```

**Expected:** Only allowed exceptions remain (device fingerprint, reset epoch).

### 2. Check Store Hydration Flags
```bash
# All stores should have _hasHydrated: true by default
grep -r "_hasHydrated: false" stores/
```

**Expected:** 0 matches (all should be `true`).

### 3. Verify No Persisted State Keys
```bash
# Check for any remaining storage key definitions
grep -r "name:.*-storage" stores/
```

**Expected:** 0 matches in refactored stores.

---

## MANUAL TEST CHECKLIST

### a) Fresh Install → Email Field Empty
1. Uninstall app completely
2. Reinstall app
3. Navigate to email/phone entry screen
4. **Expected:** Email field is EMPTY (not pre-filled)
5. **Expected:** Phone field is EMPTY (not pre-filled)

### b) Login → Restart App → No Locally Remembered Inputs
1. Login with email/phone
2. Complete onboarding (name, photos, bio, etc.)
3. Force-quit app
4. Relaunch app
5. **Expected:** All user data is GONE from local memory
6. **Expected:** Login screen shows (user not authenticated locally)
7. Login again
8. **Expected:** User data loads from Convex, not local storage

### c) All User Info Rehydrates from Convex Only
1. Login
2. Complete onboarding with profile data
3. Force-quit app
4. Relaunch app and login
5. **Expected:** Profile data loads from Convex queries (check logs)
6. **Expected:** No "[HYDRATION] authStore/onboardingStore" logs from AsyncStorage
7. **Expected:** Only Convex query logs

### d) Photos Show Correctly from Convex
1. Upload 3 photos during onboarding
2. Complete onboarding
3. Force-quit app
4. Relaunch app and login
5. Navigate to profile/photos screen
6. **Expected:** All 3 photos display from Convex storage URLs (not file:// URIs)
7. **Expected:** No missing photo placeholders

### e) Uninstall/Reinstall → Still Correct from Convex
1. Complete onboarding with full profile
2. Uninstall app
3. Reinstall app
4. Login with same credentials
5. **Expected:** All profile data loads from Convex
6. **Expected:** Photos, bio, preferences all present
7. **Expected:** No data loss

---

## LOGS TO WATCH FOR

### ✅ GOOD LOGS (After Implementation)
```
[Convex] Loading user profile...
[Convex] Hydrating onboardingStore from getCurrentUser
[Convex] Hydrating privacyStore from getPrivacySettings
[PHOTO] Rendering from Convex URL: https://...
```

### ❌ BAD LOGS (Should NOT Appear)
```
[HYDRATION] authStore: 45ms
[HYDRATION] onboardingStore: 120ms
[HYDRATION] auth-storage payload: 1024 bytes
AsyncStorage.getItem('auth-storage')
AsyncStorage.setItem('onboarding-storage')
```

---

## SUMMARY

### ✅ Completed (6 files)
1. authStore.ts - Core auth state
2. authBootCache.ts - Fast boot routing
3. bootCache.ts - Demo boot cache
4. onboardingStore.ts - ALL onboarding data (618 lines)
5. privacyStore.ts - Privacy settings
6. verificationStore.ts - Verification statuses

### ⏳ Remaining Work
- **26 more stores** to refactor (apply same pattern)
- **9 direct AsyncStorage usage** locations to remove/move to Convex
- **Convex hydration** expansion in `_layout.tsx`
- **Auth screens** email/phone pre-fill removal
- **TypeScript compilation** verification
- **Manual testing** against checklist

### Pattern Established
Clear refactoring pattern documented and demonstrated. Each store follows:
1. Remove persist middleware
2. Remove AsyncStorage imports
3. Set _hasHydrated to true
4. Add storage policy comment
5. Keep all actions unchanged

### Next Steps for Completion
1. Apply pattern to remaining 26 stores
2. Remove direct AsyncStorage usage (9 locations)
3. Expand Convex hydration in _layout.tsx
4. Remove auth field pre-filling
5. Run TypeScript compilation
6. Execute manual test checklist
7. Verify with grep commands

---

## CONTACT

For questions or issues during implementation:
- Refer to completed stores as examples (authStore.ts, onboardingStore.ts)
- Follow the refactoring pattern exactly
- Test incrementally after each store
- Watch for TypeScript errors immediately

**Target:** Zero local user data persistence. Convex is the ONLY source of truth.

# Remaining Stores Refactoring - Exact Instructions

## Status: 12 Stores Remaining (out of 30 total)

### ✅ COMPLETED (18 stores)
1. authStore.ts
2. authBootCache.ts
3. bootCache.ts
4. onboardingStore.ts
5. privacyStore.ts
6. verificationStore.ts
7. filterStore.ts
8. blockStore.ts
9. incognitoStore.ts
10. chatRoomProfileStore.ts
11. chatRoomSessionStore.ts
12. preferredChatRoomStore.ts
13. chatRoomDmStore.ts (confirmed via earlier exploration)
14. interactionStore.ts (confirmed via earlier exploration)
15. todIdentityStore.ts (confirmed via earlier exploration)
16. locationStore.ts (never had persist - runtime only)
17. bootStore.ts
18. index.ts (exports only)

### ⏳ REMAINING (12 stores - MUST REFACTOR)

#### Small/Medium Priority (6 stores - ~1000 lines total)
1. **confessPreviewStore.ts** (84 lines)
2. **demoChatRoomStore.ts** (77 lines)
3. **mediaViewStore.ts** (147 lines)
4. **photoBlurStore.ts** (153 lines)
5. **discoverStore.ts** (192 lines)
6. **subscriptionStore.ts** (247 lines)

#### Medium/Large Priority (3 stores - ~1500 lines total)
7. **demoDmStore.ts** (374 lines)
8. **privateChatStore.ts** (464 lines)
9. **chatTodStore.ts** (587 lines)

#### Large Priority (2 stores - ~2100 lines total)
10. **privateProfileStore.ts** (640 lines)
11. **confessionStore.ts** (1015 lines)

#### Extra Large (1 store - ~1500 lines)
12. **demoStore.ts** (1458 lines)

---

## REFACTORING PATTERN (Apply to Each Store)

### Step 1: Remove Imports
```typescript
// DELETE these lines:
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
```

### Step 2: Add Storage Policy Comment
```typescript
// ADD after file header comment:
// STORAGE POLICY: NO local persistence. Convex is ONLY source of truth.
// All data is ephemeral (in-memory only) and rehydrates from Convex on app boot.
```

### Step 3: Remove persist() Wrapper
```typescript
// BEFORE:
export const useMyStore = create<MyState>()(
  persist(
    (set) => ({
      ...state,
      _hasHydrated: false,
      // ... actions
    }),
    {
      name: "my-storage",
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

// AFTER:
export const useMyStore = create<MyState>()((set) => ({
  ...state,
  _hasHydrated: true, // Always ready - no AsyncStorage
  setHasHydrated: (state) => set({ _hasHydrated: true }), // No-op
  // ... actions (unchanged)
}));
```

### Step 4: Remove Hydration Logic
```typescript
// DELETE:
- const STORE_LOAD_TIME = Date.now();
- const HYDRATION_TIMEOUT_MS = 5000;
- let _hydrationTimeoutId = ...;
- function setupHydrationTimeout() { ... }
- setupHydrationTimeout();
- Any partialize functions
```

### Step 5: Update _hasHydrated
```typescript
// BEFORE:
_hasHydrated: false,
setHasHydrated: (state) => set({ _hasHydrated: state }),

// AFTER:
_hasHydrated: true, // Always ready - no AsyncStorage
setHasHydrated: (state) => set({ _hasHydrated: true }), // No-op
```

---

## EXACT COMMANDS FOR EACH STORE

### 1. confessPreviewStore.ts (84 lines)
```bash
# Manual refactor required - file is small
# Remove persist wrapper, add policy comment
# Keep all actions unchanged
```

### 2. demoChatRoomStore.ts (77 lines)
```bash
# Manual refactor required - file is small
# Keep demo message functionality
```

### 3. mediaViewStore.ts (147 lines)
```bash
# Manual refactor required
# Viewed media IDs - must rehydrate from Convex
```

### 4. photoBlurStore.ts (153 lines)
```bash
# Manual refactor required
# Per-user blur settings - must rehydrate from Convex
```

### 5. discoverStore.ts (192 lines)
```bash
# Manual refactor required
# Daily like limits, standout limits - must rehydrate from Convex
```

### 6. subscriptionStore.ts (247 lines)
```bash
# Manual refactor required
# Subscription tier, limits - must rehydrate from Convex
```

### 7. demoDmStore.ts (374 lines)
```bash
# Manual refactor required
# Demo DM conversations - can remain demo-only or remove
```

### 8. privateChatStore.ts (464 lines)
```bash
# Manual refactor required
# Conversations, messages, dares - CRITICAL - must rehydrate from Convex
```

### 9. chatTodStore.ts (587 lines)
```bash
# Manual refactor required
# Truth-or-Dare game state - must rehydrate from Convex
```

### 10. privateProfileStore.ts (640 lines)
```bash
# Manual refactor required
# Phase-2 profile data - CRITICAL - must rehydrate from Convex
```

### 11. confessionStore.ts (1015 lines)
```bash
# Manual refactor required - LARGE FILE
# Confessions, reactions, chats, crushes - must rehydrate from Convex
```

### 12. demoStore.ts (1458 lines)
```bash
# Manual refactor required - EXTRA LARGE FILE
# Demo profiles, matches, likes - can remain demo-only or remove
# This is the largest store
```

---

## VERIFICATION AFTER REFACTORING

### Check No persist() Remaining
```bash
grep -r "persist(" /Users/durgaprasad/Mira/stores/*.ts
# Expected: 0 matches (or only in index.ts exports)
```

### Check No AsyncStorage Imports in Stores
```bash
grep -r "from '@react-native-async-storage/async-storage'" /Users/durgaprasad/Mira/stores/*.ts
# Expected: 0 matches
```

### Check No Storage Keys
```bash
grep -r 'name:.*-storage' /Users/durgaprasad/Mira/stores/*.ts
# Expected: 0 matches
```

### Check All _hasHydrated Are True
```bash
grep -r "_hasHydrated: false" /Users/durgaprasad/Mira/stores/*.ts
# Expected: 0 matches
```

---

## PRIORITY ORDER FOR COMPLETION

### HIGH PRIORITY (User Data - Do First)
1. privateChatStore.ts - Messages, conversations
2. privateProfileStore.ts - Phase-2 profile
3. subscriptionStore.ts - Subscription tier
4. photoBlurStore.ts - Blur settings
5. discoverStore.ts - Like limits
6. chatTodStore.ts - Game state

### MEDIUM PRIORITY (Supporting Data)
7. mediaViewStore.ts - Viewed media
8. confessionStore.ts - Confessions

### LOW PRIORITY (Demo/Non-Critical)
9. demoStore.ts - Demo profiles
10. demoDmStore.ts - Demo DMs
11. demoChatRoomStore.ts - Demo chat rooms
12. confessPreviewStore.ts - Preview tracking

---

## AUTOMATED REFACTORING SCRIPT

Due to complexity, manual refactoring recommended. However, here's a helper script:

```bash
#!/bin/bash

refactor_store() {
    local file="$1"
    local basename=$(basename "$file")

    echo "Refactoring $basename..."

    # 1. Create backup
    cp "$file" "${file}.backup"

    # 2. Remove persist import line
    sed -i '' '/import.*persist.*createJSONStorage/d' "$file"

    # 3. Remove AsyncStorage import line
    sed -i '' "/import AsyncStorage from '@react-native-async-storage/d" "$file"

    # 4. Change _hasHydrated: false to true
    sed -i '' 's/_hasHydrated: false/_hasHydrated: true/g' "$file"

    # 5. Manual intervention still required for:
    #    - Adding storage policy comment
    #    - Removing persist() wrapper
    #    - Removing onRehydrateStorage
    #    - Removing hydration timeout logic

    echo "  ✓ Imports removed"
    echo "  ✓ _hasHydrated set to true"
    echo "  ⚠ MANUAL: Add storage policy comment"
    echo "  ⚠ MANUAL: Remove persist() wrapper"
    echo "  ⚠ MANUAL: Remove hydration callbacks"
    echo ""
}

# Run for all remaining stores
for store in confessPreviewStore demoChatRoomStore mediaViewStore photoBlurStore \
             discoverStore subscriptionStore demoDmStore privateChatStore chatTodStore \
             privateProfileStore confessionStore demoStore; do
    refactor_store "/Users/durgaprasad/Mira/stores/${store}.ts"
done
```

---

## MANUAL VERIFICATION CHECKLIST

For EACH refactored store, verify:
- [ ] No `import { persist, createJSONStorage }` line
- [ ] No `import AsyncStorage` line
- [ ] Has storage policy comment at top
- [ ] `_hasHydrated: true` by default
- [ ] `setHasHydrated` is a no-op: `set({ _hasHydrated: true })`
- [ ] No `persist()` wrapper around `create()`
- [ ] No `onRehydrateStorage` callback
- [ ] No `STORE_LOAD_TIME` constant
- [ ] No hydration timeout logic
- [ ] All action methods unchanged
- [ ] All state fields unchanged

---

## ESTIMATED EFFORT

- Small stores (6): 5 min each = 30 min
- Medium stores (3): 10 min each = 30 min
- Large stores (2): 20 min each = 40 min
- Extra large (1): 30 min = 30 min

**Total: ~2 hours 10 minutes**

---

## NEXT AFTER STORES: DIRECT ASYNCSTORAGE REMOVAL (TASK B)

After stores are refactored, proceed to Task B:
1. camera-composer.tsx - Media handoff
2. incognito-chat.tsx - Secure media handoff
3. ChatTodOverlay.tsx - T&D answer
4. [roomId].tsx - Muting
5. [roomId].tsx - Reports
6. BottleSpinGame.tsx - Skip tracking

Then Task C: Auth prefill removal
Then Task D: Convex hydration expansion

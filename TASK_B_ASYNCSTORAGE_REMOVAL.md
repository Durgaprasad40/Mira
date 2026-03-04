# TASK B - Remove Direct AsyncStorage User Data Usage

## HIGH PRIORITY: 6 Locations Found

All AsyncStorage usage for user data must be removed. Replace with:
- In-memory navigation params
- Ephemeral in-memory store (cleared on component unmount)
- Convex mutations (for persistent data like muting/reports)

---

## 1. app/(main)/camera-composer.tsx

**Current behavior:**
- Stores captured media to AsyncStorage as handoff mechanism
- Keys: `tod_captured_media`, `tod_camera_answer_{conversationId}`
- Data: uri, type, duration, visibility, isMirrored

**Location:** Lines 160-174
```typescript
// REMOVE THIS:
await AsyncStorage.setItem(storageKey, JSON.stringify({
  uri: permanentUri,
  type: capturedType,
  mediaUri: permanentUri,
  promptId: params.promptId,
  durationSec: capturedType === 'video' ? videoSeconds : undefined,
  visibility: isSecureCapture ? undefined : mediaVisibility,
  isMirrored: capturedFacing === 'front',
}));
router.back();
```

**SOLUTION:**
Replace with navigation params:
```typescript
// NEW CODE:
router.back();
// Pass media data via router params or event emitter
// The receiving screen must be updated to receive params instead of reading AsyncStorage
```

**Files that need updating:**
1. camera-composer.tsx - Remove AsyncStorage.setItem
2. Files that read this data:
   - Search for `AsyncStorage.getItem('tod_captured_media')`
   - Search for `AsyncStorage.getItem('tod_camera_answer_')`
   - Update to receive via navigation params or ephemeral store

**Grep commands:**
```bash
grep -r "tod_captured_media" /Users/durgaprasad/Mira/app/ /Users/durgaprasad/Mira/components/
grep -r "tod_camera_answer" /Users/durgaprasad/Mira/app/ /Users/durgaprasad/Mira/components/
```

---

## 2. app/(main)/incognito-chat.tsx

**Current behavior:**
- Stores secure media handoff data
- Key: `secure_capture_media_{id}`

**Location:** Lines 218, 221
```typescript
// REMOVE THIS:
await AsyncStorage.setItem(key, JSON.stringify(mediaData));
// Later:
const stored = await AsyncStorage.getItem(key);
if (stored) {
  await AsyncStorage.removeItem(key);
}
```

**SOLUTION:**
Use in-memory state or navigation params:
```typescript
// Create ephemeral store or use React state
// No AsyncStorage persistence
```

**Files that need updating:**
1. incognito-chat.tsx - Remove all AsyncStorage calls for media handoff
2. Verify media is uploaded to Convex immediately after capture
3. UI renders from Convex URL, not local file://

**Grep commands:**
```bash
grep -r "secure_capture_media" /Users/durgaprasad/Mira/app/
```

---

## 3. components/truthdare/ChatTodOverlay.tsx

**Current behavior:**
- Stores T&D camera answer data
- Key: `tod_camera_answer_{conversationId}`

**Location:** Lines 210, 214
```typescript
// REMOVE THIS:
await AsyncStorage.setItem(key, JSON.stringify(answerData));
// Later:
const answer = await AsyncStorage.getItem(key);
await AsyncStorage.removeItem(key);
```

**SOLUTION:**
Use ephemeral component state or event system:
```typescript
// Store answer in component state
// When camera returns, update state directly (no AsyncStorage)
// Submit to Convex immediately
```

**Files that need updating:**
1. ChatTodOverlay.tsx - Remove AsyncStorage handoff
2. camera-composer.tsx - Already handled in #1 above

**Grep commands:**
```bash
grep -r "tod_camera_answer" /Users/durgaprasad/Mira/components/
```

---

## 4. app/(main)/(private)/(tabs)/chat-rooms/[roomId].tsx - Room Muting

**Current behavior:**
- Stores room mute state locally
- Key: `mute_room_{roomId}`

**Location:** Line 562 (approximate)
```typescript
// REMOVE THIS:
await AsyncStorage.setItem(`mute_room_${roomId}`, 'true');
// Later:
const muted = await AsyncStorage.getItem(`mute_room_${roomId}`);
```

**SOLUTION:**
Store mute preferences in Convex:
```typescript
// Create Convex mutation: muteRoom(roomId, muted)
// Create Convex query: getRoomMuteStatus(roomId)
// Use these instead of AsyncStorage
```

**Convex changes needed:**
```typescript
// convex/chatRooms.ts or convex/userSettings.ts

export const muteRoom = mutation({
  args: { roomId: v.string(), muted: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    // Store mute preference in user settings table
    // Key: userId + roomId
  },
});

export const getRoomMuteStatus = query({
  args: { roomId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    // Fetch mute status from user settings
    return { muted: false }; // or actual value
  },
});
```

**Files that need updating:**
1. [roomId].tsx - Replace AsyncStorage with Convex calls
2. Create/update Convex schema for user room settings

**Grep commands:**
```bash
grep -r "mute_room_" /Users/durgaprasad/Mira/app/
```

---

## 5. app/(main)/(private)/(tabs)/chat-rooms/[roomId].tsx - Reports

**Current behavior:**
- Stores report drafts or report state locally
- Key: `chat_room_reports`

**Location:** Lines 970-990 (approximate)
```typescript
// REMOVE THIS:
await AsyncStorage.setItem('chat_room_reports', JSON.stringify(reports));
// Later:
const stored = await AsyncStorage.getItem('chat_room_reports');
```

**SOLUTION:**
Submit reports to Convex immediately:
```typescript
// No local storage of reports
// Submit directly to Convex mutation: reportUser() or reportMessage()
// Reports should be server-side only for moderation
```

**Convex changes needed:**
```typescript
// convex/moderation.ts

export const reportUser = mutation({
  args: {
    reportedUserId: v.string(),
    reason: v.string(),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const reporterId = await requireUser(ctx);
    await ctx.db.insert('reports', {
      reporterId,
      reportedUserId: args.reportedUserId,
      reason: args.reason,
      details: args.details,
      timestamp: Date.now(),
    });
  },
});
```

**Files that need updating:**
1. [roomId].tsx - Remove AsyncStorage, use Convex mutation
2. Create Convex reports table if not exists

**Grep commands:**
```bash
grep -r "chat_room_reports" /Users/durgaprasad/Mira/app/
```

---

## 6. components/chat/BottleSpinGame.tsx

**Current behavior:**
- Stores game skip tracking locally
- Key: `bottle_spin_skip_{conversationId}_{userId}`

**Location:** Lines 85, 98 (approximate)
```typescript
// REMOVE THIS:
await AsyncStorage.setItem(key, JSON.stringify({
  skipCount: count,
  resetAt: timestamp,
}));
// Later:
const stored = await AsyncStorage.getItem(key);
```

**SOLUTION:**
Store skip tracking in Convex:
```typescript
// Create Convex mutation: trackGameSkip(conversationId)
// Create Convex query: getGameSkipCount(conversationId)
// Enforce skip limits server-side
```

**Convex changes needed:**
```typescript
// convex/games.ts

export const trackGameSkip = mutation({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    // Increment skip count for this user + conversation
    // Auto-reset after 24 hours
  },
});

export const getGameSkipCount = query({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    // Return skip count and reset timestamp
    return { skipCount: 0, canSkip: true };
  },
});
```

**Files that need updating:**
1. BottleSpinGame.tsx - Replace AsyncStorage with Convex calls

**Grep commands:**
```bash
grep -r "bottle_spin_skip" /Users/durgaprasad/Mira/components/
```

---

## MEDIUM PRIORITY: UI State (2 Locations)

### 7. app/(main)/(tabs)/nearby.tsx - FAB Position

**Current behavior:**
- Stores FAB x/y coordinates
- Key: `nearby_fab_position`

**Location:** Lines 486, 524

**DECISION:**
This is arguably NOT user information (it's UI preference).
- Option A: Remove (FAB resets to default position each time)
- Option B: Keep as allowed exception (UI state, not user data)

**Recommended:** REMOVE for consistency (user can reposition each time)

```typescript
// REMOVE THIS:
await AsyncStorage.setItem('nearby_fab_position', JSON.stringify({ x, y }));
```

**Grep commands:**
```bash
grep -r "nearby_fab_position" /Users/durgaprasad/Mira/app/
```

### 8. app/(main)/settings/privacy.tsx - Warning Shown Flag

**Current behavior:**
- Stores one-time warning flag
- Key: `hide_discover_warning_shown`

**Location:** Lines 35, 50

**DECISION:**
Remove - user can see warning every time or store in Convex if needed.

```typescript
// REMOVE THIS:
await AsyncStorage.setItem('hide_discover_warning_shown', 'true');
```

**Grep commands:**
```bash
grep -r "hide_discover_warning_shown" /Users/durgaprasad/Mira/app/
```

---

## ALLOWED EXCEPTIONS (System Data - NOT User Info)

### ✅ lib/deviceFingerprint.ts - Install ID
**Key:** `mira_install_id`
**Reason:** Device identification for crash reports, NOT user information
**Action:** KEEP AS IS

### ✅ lib/resetEpochCheck.ts - Reset Epoch
**Key:** `mira:resetEpoch`
**Reason:** System cache invalidation marker, NOT user information
**Action:** KEEP AS IS

---

## VERIFICATION COMMANDS

### Find ALL AsyncStorage Usage
```bash
# Find all AsyncStorage imports
grep -r "from '@react-native-async-storage/async-storage'" /Users/durgaprasad/Mira/app/ /Users/durgaprasad/Mira/components/ /Users/durgaprasad/Mira/lib/

# Find all setItem calls
grep -r "AsyncStorage.setItem" /Users/durgaprasad/Mira/app/ /Users/durgaprasad/Mira/components/

# Find all getItem calls
grep -r "AsyncStorage.getItem" /Users/durgaprasad/Mira/app/ /Users/durgaprasad/Mira/components/
```

### Expected After Completion
Only these files should have AsyncStorage:
- lib/deviceFingerprint.ts (install ID)
- lib/resetEpochCheck.ts (reset epoch)

All app/ and components/ files should have NO AsyncStorage for user data.

---

## IMPLEMENTATION PRIORITY

1. **IMMEDIATE:**
   - #4 Room muting (affects UX)
   - #5 Reports (security/moderation)

2. **HIGH:**
   - #1 Camera handoff (common flow)
   - #2 Incognito media (privacy feature)
   - #3 T&D answer (game feature)
   - #6 Skip tracking (game feature)

3. **MEDIUM:**
   - #7 FAB position (nice-to-have)
   - #8 Warning flag (nice-to-have)

---

## CONVEX SCHEMA CHANGES NEEDED

### User Settings Table
```typescript
// convex/schema.ts

userSettings: defineTable({
  userId: v.string(),
  roomMutes: v.optional(v.object({
    // roomId -> muted (boolean)
  })),
  // ... other settings
}).index('by_user', ['userId']),
```

### Reports Table
```typescript
reports: defineTable({
  reporterId: v.string(),
  reportedUserId: v.string(),
  reason: v.string(),
  details: v.optional(v.string()),
  timestamp: v.number(),
  status: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('actioned')),
}).index('by_reporter', ['reporterId'])
  .index('by_reported', ['reportedUserId']),
```

### Game State Table
```typescript
gameState: defineTable({
  userId: v.string(),
  conversationId: v.string(),
  skipCount: v.number(),
  resetAt: v.number(),
}).index('by_user_conversation', ['userId', 'conversationId']),
```

---

## ESTIMATED EFFORT

- Camera handoff (#1-3): 45 minutes (3 files, navigation params refactor)
- Room muting (#4): 30 minutes (Convex mutation + query)
- Reports (#5): 30 minutes (Convex mutation)
- Skip tracking (#6): 30 minutes (Convex mutation + query)
- FAB position (#7): 10 minutes (remove only)
- Warning flag (#8): 10 minutes (remove only)

**Total: ~2 hours 35 minutes**

---

## SUMMARY

**Total locations:** 8
**High priority:** 6 (user data)
**Medium priority:** 2 (UI state)
**Allowed exceptions:** 2 (system data)

**Actions required:**
1. Remove AsyncStorage calls from 8 locations
2. Add 3-4 new Convex mutations
3. Add 3-4 new Convex queries
4. Update navigation to pass params instead of AsyncStorage
5. Test all affected flows

**End state:** Zero AsyncStorage usage for user information. Only device fingerprint and reset epoch remain.

# Complete App Map & Bug-Fix Plan — Mira

---

## A) Project Overview

- **App name**: Mira — a dating/social app with two "faces" (public + private 18+ mode)
- **Framework**: Expo SDK 54, React Native 0.81.5, React 19.1.0
- **Navigation**: expo-router 6.0.23 (file-based routing)
- **Backend**: Convex 1.31.7 (real-time database, queries, mutations)
- **State management**: Zustand 5.0.2 (12 stores, 9 with AsyncStorage persistence)
- **Auth**: Email/password + OTP via Convex mutations, session tokens
- **Maps**: react-native-maps + expo-location (Nearby + Crossed Paths)
- **Media**: expo-camera, expo-image-picker, expo-image-manipulator, protected media with per-recipient permissions
- **Notifications**: Convex-backed notification table + demo Zustand store
- **Demo mode**: `EXPO_PUBLIC_DEMO_MODE=true` — Convex client closed at load, all queries skipped, static demo data used
- **Live mode**: Convex cloud (`proper-platypus-824.convex.cloud`)
- **Platform targets**: iOS (no tablet), Android (edge-to-edge), Web
- **New Architecture**: Enabled
- **Schema size**: 42 Convex tables, 85 mutations, 54 queries
- **Dev command**: `npx expo start` (port 8081)
- **Build**: Standard Expo EAS Build (no custom native code observed)
- **Stability toggle**: `config/stability.ts` defines `STABILITY_MODE = true` but it is **never imported** anywhere — dead code
- **Current env**: Demo mode is ON (`.env.local` has `EXPO_PUBLIC_DEMO_MODE=true`)

---

## B) App Navigation Map

```
app/
├── _layout.tsx              — Root: ConvexProvider, GestureHandler, DeviceFingerprint
├── index.tsx                — Auth guard → redirects to (auth), (onboarding), or (main)
│
├── (auth)/
│   ├── _layout.tsx          — Stack for auth screens
│   ├── welcome.tsx          — Welcome/splash with CTA
│   └── login.tsx            — Email/password login form
│
├── (onboarding)/
│   ├── _layout.tsx          — Stack for 16-step onboarding
│   ├── index.tsx            — Redirect to welcome
│   ├── welcome.tsx          — Intro to Mira
│   ├── email-phone.tsx      — Email or phone input
│   ├── otp.tsx              — 6-digit OTP verification
│   ├── password.tsx         — Password creation
│   ├── basic-info.tsx       — Name, DOB, gender
│   ├── photo-upload.tsx     — First profile photo
│   ├── face-verification.tsx— Camera-based face verify
│   ├── additional-photos.tsx— Up to 6 photos
│   ├── bio.tsx              — Bio text
│   ├── prompts.tsx          — 3 icebreaker prompts
│   ├── profile-details.tsx  — Height, lifestyle, etc.
│   ├── preferences.tsx      — Gender pref, intent, age/distance
│   ├── permissions.tsx      — Location + notification perms
│   ├── review.tsx           — Final review before submit
│   └── tutorial.tsx         — Swipe tutorial
│
├── (main)/
│   ├── _layout.tsx          — Main Stack + verification redirect
│   │
│   ├── (tabs)/
│   │   ├── _layout.tsx      — Tab bar: Home, Explore, Confess, Nearby, Messages, Private, Profile
│   │   ├── home.tsx         — Swipe card stack (DiscoverCardStack)
│   │   ├── discover.tsx     — Grid feed of profiles (DiscoverFeed) — hidden tab (href: null)
│   │   ├── explore.tsx      — Category/tag browsing with filters
│   │   ├── confessions.tsx  — Anonymous confession feed
│   │   ├── nearby.tsx       — Map view of nearby users
│   │   ├── messages.tsx     — Conversation list
│   │   ├── incognito.tsx    — Redirect to (private) Face 2
│   │   ├── rooms.tsx        — Redirect (unused)
│   │   └── profile.tsx      — Current user profile
│   │
│   ├── (private)/
│   │   ├── _layout.tsx      — Age gate + setup check + back-nav intercept
│   │   └── (tabs)/
│   │       ├── _layout.tsx  — Private tab bar
│   │       ├── desire-land.tsx   — Dark-themed swipe stack
│   │       ├── truth-or-dare.tsx — Trending T&D prompts
│   │       ├── chat-rooms.tsx    — Private room list
│   │       ├── rooms.tsx         — Available rooms to join
│   │       ├── chats.tsx         — Private conversations
│   │       ├── confess.tsx       — Stub (not available in Face 2)
│   │       └── private-profile.tsx — Private profile editor
│   │
│   ├── (private-setup)/
│   │   ├── _layout.tsx          — 4-step setup wizard
│   │   ├── select-photos.tsx    — Pick photos to blur
│   │   ├── blur-preview.tsx     — Preview blur effect
│   │   ├── categories.tsx       — Intent, desires, boundaries
│   │   └── activate.tsx         — Final activation
│   │
│   ├── chat/[id].tsx            — DM thread with protected media
│   ├── chat-room/[roomId].tsx   — Group chat room
│   ├── incognito-chat.tsx       — Private DM
│   ├── incognito-room/[id].tsx  — Private room chat
│   ├── incognito-create-tod.tsx — Create T&D post
│   ├── profile/[id].tsx         — View other user's profile
│   ├── private-profile/[userId].tsx — View private profile
│   ├── crossed-paths.tsx        — Location-based encounters
│   ├── confession-thread.tsx    — Single confession + replies
│   ├── confession-chat.tsx      — 1:1 with confession author
│   ├── compose-confession.tsx   — Create confession
│   ├── prompt-thread.tsx        — T&D prompt thread
│   ├── person-picker.tsx        — Search/select person
│   ├── dare/index.tsx           — Pending/sent dares
│   ├── dare/send.tsx            — Send a dare
│   ├── likes.tsx                — Who liked you
│   ├── pre-match-message.tsx    — Message before matching
│   ├── match-celebration.tsx    — Match animation
│   ├── notifications.tsx        — Notification list
│   ├── room/[id].tsx            — Public group room
│   ├── edit-profile.tsx         — Edit profile fields
│   ├── stand-out.tsx            — Send stand-out message
│   ├── verification.tsx         — Face verification camera
│   ├── boost.tsx                — Purchase boost
│   ├── subscription.tsx         — Subscription plans
│   ├── settings.tsx             — App settings
│   ├── camera-composer.tsx      — Camera for T&D responses
│   ├── community-guidelines.tsx — Guidelines text
│   └── safety-reporting.tsx     — Report/block instructions
```

**Total screens**: ~65 | **Layout files**: 10 | **Dynamic routes**: 7

---

## C) Features Inventory

### 1. Matching / Swipe / Discover

| | |
|---|---|
| **Entry screens** | `home.tsx` (card stack), `discover.tsx` (grid feed — hidden tab) |
| **Components** | `DiscoverCardStack`, `DiscoverFeed`, `ProfileCard`, `SwipeOverlay` |
| **Hooks/Stores** | `discoverStore` (daily limits), `filterStore` (filters), `interactionStore` (stand-out result) |
| **Convex** | `discover.getDiscoverProfiles`, `likes.swipe`, `likes.rewind`, `matches.*` |
| **Note** | Two separate discover UIs (CardStack + Feed) both call `getDiscoverProfiles` |

### 2. Explore

| | |
|---|---|
| **Entry screen** | `explore.tsx` |
| **Components** | Category grid + "People to Meet" cards (inline) |
| **Hooks/Stores** | `authStore` (userId) |
| **Convex** | `discover.getExploreProfiles` |

### 3. Chat (DM + Room)

| | |
|---|---|
| **Entry screens** | `messages.tsx` (list), `chat/[id].tsx` (DM), `chat-room/[roomId].tsx` (room) |
| **Components** | Inline message bubbles, `ActiveUsersStrip` |
| **Hooks/Stores** | `demoDmStore`, `demoChatRoomStore`, `useKeyboardHeight`, `useMessageQuota` |
| **Convex** | `messages.*`, `chatRooms.*`, `protectedMedia.*` |

### 4. Private / Incognito (Face 2)

| | |
|---|---|
| **Entry screens** | `incognito.tsx` (redirect), `desire-land.tsx`, `truth-or-dare.tsx`, `chat-rooms.tsx`, `chats.tsx` |
| **Components** | Reuses `DiscoverCardStack` (dark theme) |
| **Hooks/Stores** | `incognitoStore`, `privateProfileStore`, `privateChatStore` |
| **Convex** | `privateProfiles.*`, `revealRequests.*`, `truthDare.*`, `chatRooms.*` |

### 5. Confessions

| | |
|---|---|
| **Entry screens** | `confessions.tsx` (feed), `confession-thread.tsx`, `confession-chat.tsx`, `compose-confession.tsx` |
| **Hooks/Stores** | `confessionStore` (persisted, with migration), `useConfessionNotifications` |
| **Convex** | `confessions.*` |

### 6. Notifications

| | |
|---|---|
| **Entry screen** | `notifications.tsx` |
| **Hooks/Stores** | `useNotifications` (dual-mode: Zustand demo + Convex live), `useDemoNotifStore` |
| **Convex** | `notifications.*` |

### 7. Protected Media / Screenshot Detection

| | |
|---|---|
| **Entry** | Inside `chat/[id].tsx` |
| **Hooks** | `useScreenProtection`, `useScreenshotDetection`, `useScreenRecordingDetection` |
| **Convex** | `protectedMedia.*` (per-recipient permissions, view counts, security events) |

### 8. Safety / Moderation / Reports / Blocks

| | |
|---|---|
| **Entry screens** | `safety-reporting.tsx`, `community-guidelines.tsx`, inline report buttons |
| **Convex** | `users.blockUser`, `users.reportUser`, `confessions.reportConfession`, tables: `reports`, `blocks`, `behaviorFlags`, `moderationQueue`, `userStrikes` |

---

## D) State & Data Flow

### Zustand Stores

| Store | Persisted | Key State |
|-------|-----------|-----------|
| `authStore` | Yes | userId, token, isAuthenticated, onboardingCompleted |
| `onboardingStore` | Yes | All 16 onboarding fields (name, photos, bio, prefs…) |
| `filterStore` | No | gender, age range, distance, activities, sortBy |
| `discoverStore` | Yes (partial) | likesUsedToday, standOutsUsedToday, lastResetDate |
| `subscriptionStore` | Yes | tier, limits (likes, messages, boosts…), expiry |
| `incognitoStore` | Yes (partial) | ageConfirmed18Plus, ageConfirmedAt |
| `privateProfileStore` | Yes (partial) | wizard steps, blurred photos, intent, desires, boundaries |
| `confessionStore` | Yes (partial) | confessions[], userReactions, chats[], secretCrushes[] |
| `privateChatStore` | No | unlockedUsers, conversations, pendingDares |
| `demoDmStore` | Yes | conversations (demo DM messages) |
| `demoChatRoomStore` | Yes | rooms (demo room messages) |
| `interactionStore` | No | composeResult, personPickerResult, standOutResult |

### Convex Query Usage by Screen (live mode)

| Screen | Queries |
|--------|---------|
| home (DiscoverCardStack) | `discover.getDiscoverProfiles` |
| discover (DiscoverFeed) | `discover.getDiscoverProfiles` |
| explore | `discover.getExploreProfiles` |
| messages | `messages.getConversations`, `matches.getMatches`, `likes.getLikesReceived`, `likes.getLikeCount` |
| confessions | `confessions.listConfessions` |
| nearby | `crossedPaths.getNearbyUsers` |
| profile | `users.getCurrentUser` |
| MainLayout | `users.getCurrentUser` |
| DiscoverCardStack | `discover.getDiscoverProfiles` |
| useNotifications | `notifications.getNotifications` |

---

## E) Known Bug Risks & Warnings

### HIGH Severity

**1) WARNING: Inline Convex query args cause re-subscriptions**
- Where: `DiscoverCardStack.tsx:98-103`, `DiscoverFeed.tsx:73-77`, `messages.tsx:25-43`
- Why: `useQuery(api.foo, { userId: userId as any, ... })` creates a new object every render. Convex treats new object references as new subscriptions.
- Symptom: Unnecessary network traffic, potential flickering, wasted bandwidth.
- Fix: Wrap query args in `useMemo` keyed on the actual primitive values.

**2) WARNING: DiscoverFeed profile mapping not memoized**
- Where: `components/screens/DiscoverFeed.tsx:84-105`
- Why: `DEMO_PROFILES.map(...)` and `(convexProfiles || []).map(...)` run on every render without `useMemo`, creating new array references each time.
- Symptom: Cascading re-renders, potential touch-drop on swipe cards.
- Fix: Wrap in `useMemo` keyed on `convexProfiles`.

**3) WARNING: Race condition in swipe mutation callback**
- Where: `DiscoverCardStack.tsx:300-320`
- Why: `.then((result) => { router.push(...) })` fires after async completes. The `isFocusedRef` check exists at line 306 but `navigatingRef` is set to true with a `setTimeout(() => false, 600)` that could overlap with a new swipe.
- Symptom: Double navigation, stale navigating lock, frozen card stack.
- Fix: Add component-mounted ref check; replace `setTimeout` with navigation event listener.

**4) WARNING: `as any` type assertions throughout codebase**
- Where: 49+ files use `userId as any` for Convex Id types
- Why: Hides type mismatches between Zustand string and Convex `Id<"users">`.
- Symptom: Silent runtime failures if Id format changes; impossible to catch via TypeScript.
- Fix: Create a typed wrapper: `const convexUserId = userId as Id<"users">` with a runtime guard.

**5) WARNING: Duplicate discover implementations**
- Where: `home.tsx` uses `DiscoverCardStack`, `discover.tsx` uses `DiscoverFeed` — both call `getDiscoverProfiles`
- Why: Two UIs for the same feature, `discover.tsx` tab is hidden (`href: null`) but still mounted by the tab navigator.
- Symptom: Wasted Convex subscription in live mode (hidden tab still subscribes); confusion about which is canonical.
- Fix: Remove `discover.tsx` entirely or lazy-load it only when explicitly shown.

### MEDIUM Severity

**6) WARNING: STABILITY_MODE is dead code**
- Where: `config/stability.ts:11`
- Why: Exported but never imported anywhere. Feature gating it was meant to provide doesn't exist.
- Symptom: False sense of stability control; no actual feature gating.
- Fix: Either wire it into relevant screens or delete it.

**7) WARNING: Private layout `router.replace` on back-navigation**
- Where: `app/(main)/(private)/_layout.tsx:37`
- Why: `router.replace('/(main)/(tabs)/home')` in `beforeRemove` handler replaces the entire route, which can destroy and recreate the tab navigator.
- Symptom: Home screen remounts, DiscoverCardStack loses state.
- Fix: Use `router.navigate` instead of `router.replace`, or use `router.back()`.

**8) WARNING: `useNotifications` creates new array on every render (live mode)**
- Where: `hooks/useNotifications.ts:120`
- Why: `(convexNotifications || []).map(...)` runs every render without memoization.
- Symptom: Any component depending on `notifications` array reference re-renders unnecessarily.
- Fix: Wrap in `useMemo`.

**9) WARNING: AsyncStorage operations without mount guards**
- Where: `chat-room/[roomId].tsx:178-183` (mute state), `chat-room/[roomId].tsx:464-468` (reports)
- Why: `.then(setState)` can fire after unmount.
- Symptom: React "can't update unmounted component" warning (suppressed in React 18+, but still a logic bug).
- Fix: Add `isMountedRef` pattern or use AbortController.

**10) WARNING: Confession reaction duplicated in two handlers**
- Where: `confessions.tsx:146-158` and inline render callback
- Why: Same mutation logic in two places with slightly different behavior.
- Symptom: Fixing a bug in one path leaves the other broken.
- Fix: Extract shared `toggleReaction` function.

**11) WARNING: `standOutResult` effect missing focus guard**
- Where: `DiscoverCardStack.tsx:413-433`
- Why: Animation starts and calls `handleSwipe` on completion without checking if screen still focused.
- Symptom: Swipe action fires while user is on a different screen.
- Fix: Add `if (!isFocusedRef.current) return;` before `handleSwipe` call.

**12) WARNING: `convexProfiles || []` creates new array when undefined**
- Where: `DiscoverCardStack.tsx:135`, `DiscoverFeed.tsx:76`
- Why: When `convexProfiles` is undefined (loading), `|| []` creates new empty array each render.
- Symptom: Downstream `useMemo` sees new dependency → recomputes → new array ref → children re-render.
- Fix: Use module-scope `const EMPTY: any[] = []` as fallback (already done in `explore.tsx`).

### LOW Severity

**13) WARNING: `useState(new Set())` creates new Set each render**
- Where: `chat-room/[roomId].tsx:195`
- Why: `useState<Set<string>>(new Set())` — the `new Set()` initializer runs once, but it's better practice to use a factory: `useState(() => new Set())`.
- Symptom: None in practice (React ignores re-invocations), but misleading.
- Fix: Use factory form.

**14) WARNING: Missing `isDemoMode` check in private chat room DM**
- Where: `chat-room/[roomId].tsx:412-436`
- Why: `handlePrivateMessage` logic doesn't branch on demo mode.
- Symptom: Could call Convex mutation in demo mode (will no-op due to closed client, but adds console noise).
- Fix: Add `isDemoMode` early return.

**15) WARNING: Screen recording detection incomplete on iOS**
- Where: `hooks/useScreenRecordingDetection.ts`
- Why: Comment in code says "full detection requires native module." Current implementation uses AppState heuristic.
- Symptom: Screen recording goes undetected on iOS.
- Fix: Accept limitation or add native module (low priority).

---

## F) Bug-Fix Order (Phased Roadmap)

### Phase 1 — Stabilize Core Render Loop
**Goal**: Home tab renders 1–3 times on mount, stays stable while idle.

- Wrap Convex query args in `useMemo` in `DiscoverCardStack.tsx`
- Wrap profile mapping in `useMemo` in `DiscoverFeed.tsx`
- Replace `convexProfiles || []` with module-scope empty array in `DiscoverCardStack.tsx` and `DiscoverFeed.tsx`
- Wrap notification array in `useMemo` in `useNotifications.ts`
- Files: `DiscoverCardStack.tsx`, `DiscoverFeed.tsx`, `useNotifications.ts`
- Test: Open app → Home tab → watch Metro console for `[DCS]` or `[Home]` logs → should see 1–3 renders, then silence
- Logs: No repeated render warnings
- Stop condition: 10 seconds idle on Home with zero console output

### Phase 2 — Fix Navigation Race Conditions
**Goal**: Swiping, matching, and stand-out flows never cause double-navigation or frozen states.

- Add mounted/focused guard to swipe mutation `.then()` callback
- Replace `setTimeout(() => navigatingRef = false, 600)` with navigation event listener or single-shot timer with mounted check
- Add `isFocusedRef` check in `standOutResult` effect before `handleSwipe`
- Files: `DiscoverCardStack.tsx`
- Test: Rapid-swipe 10 profiles → trigger demo match → verify single navigation to celebration screen → back → card stack is responsive
- Logs: No `handleSwipe BLOCKED` after returning from celebration
- Stop condition: 20 rapid swipes with no crash, freeze, or double-nav

### Phase 3 — Clean Up Dead / Duplicate Code
**Goal**: No hidden tabs consuming resources, no dead config.

- Remove or lazy-gate `discover.tsx` (hidden tab that still mounts + subscribes)
- Delete `config/stability.ts` or wire it into app
- Verify `rooms.tsx` tab redirect is necessary or remove
- Files: `app/(main)/(tabs)/discover.tsx`, `app/(main)/(tabs)/rooms.tsx`, `config/stability.ts`, `app/(main)/(tabs)/_layout.tsx`
- Test: All tabs still navigate correctly, no blank screens
- Logs: No Convex subscription errors
- Stop condition: Tab count matches visible tabs; no hidden mounts in React DevTools

### Phase 4 — Stabilize Messages Tab
**Goal**: Messages tab loads without re-subscription churn.

- Wrap all 4 `useQuery` args in `useMemo` in `messages.tsx`
- Add module-scope empty arrays for fallbacks
- Files: `app/(main)/(tabs)/messages.tsx`
- Test: Open Messages tab → verify conversation list loads once → switch tabs and back → no reload flash
- Logs: No repeated Convex query logs
- Stop condition: Messages tab stable across 5 tab switches

### Phase 5 — Fix Private Mode Navigation
**Goal**: Entering and exiting Private mode doesn't remount Home/DiscoverCardStack.

- Change `router.replace('/(main)/(tabs)/home')` to `router.navigate` or `router.back()` in private `_layout.tsx`
- Verify the Home tab preserves card stack state after returning from Private
- Files: `app/(main)/(private)/_layout.tsx`
- Test: Home → Private tab → Back → Home card index should be same as before
- Logs: No `[DCS] MOUNT` after returning from Private (logs removed, but can temporarily re-add)
- Stop condition: Round-trip to Private does not reset card index

### Phase 6 — Harden Async Operations
**Goal**: No setState-on-unmounted-component patterns.

- Add `isMountedRef` pattern to `chat-room/[roomId].tsx` AsyncStorage reads
- Add focus guard to confession reaction mutation callbacks
- Extract shared `toggleReaction` handler in `confessions.tsx`
- Files: `chat-room/[roomId].tsx`, `confessions.tsx`
- Test: Open chat room → quickly navigate away → no console warnings
- Logs: Zero "can't update unmounted component" warnings
- Stop condition: Rapid navigation between all tabs produces zero warnings

### Phase 7 — Type Safety Pass
**Goal**: Replace `as any` with proper types in the most-used paths.

- Create `convex/types.ts` with typed Id helpers
- Replace `userId as any` with typed cast in stores that pass to Convex
- Start with: `DiscoverCardStack`, `messages.tsx`, `useNotifications.ts`, `confessions.tsx`
- Files: 10–15 files (highest-traffic paths first)
- Test: `npx tsc --noEmit` passes with zero errors
- Logs: N/A
- Stop condition: TypeScript reports zero errors

---

## G) Quick Smoke Test Checklist

Run these steps after every fix. If any step fails, stop and investigate before continuing.

| # | Step | Expected |
|---|------|----------|
| 1 | `npx expo start -c` | Metro bundler starts without errors |
| 2 | Open app on simulator/device | App loads without crash |
| 3 | App redirects to Home tab | Swipe card stack visible with demo profiles |
| 4 | Swipe right on a card | Card animates out, next card appears |
| 5 | Swipe left on a card | Card animates out, next card appears |
| 6 | Tap Explore tab | Category grid shows, "People to Meet" section visible |
| 7 | Tap a category (e.g. "Coffee & Cafe") | Filtered profiles shown or empty state |
| 8 | Tap Confess tab | Confession feed loads with demo confessions |
| 9 | Tap Nearby tab | Map or placeholder loads without crash |
| 10 | Tap Messages tab | Conversation list loads (demo matches/messages) |
| 11 | Tap Profile tab | Current user profile loads with photo and info |
| 12 | Tap Private tab | Age gate or private mode loads |
| 13 | Switch back to Home tab | Card stack still present, same index (not reset) |
| 14 | Rapid-tap between Home and Explore 5 times | No crash, no white screen, no freeze |
| 15 | Swipe 5 cards quickly on Home | Cards animate smoothly, no stuck overlays |
| 16 | Tap a profile name in Explore "People to Meet" | No crash (navigation may not be wired) |
| 17 | Open Metro console, idle for 10 seconds | No repeated log output while idle |
| 18 | Tap Confess → compose button | Compose confession screen opens |
| 19 | Go back from compose | Returns to confession feed, draft not lost |
| 20 | Tap Messages → tap a conversation | Chat screen opens with messages |
| 21 | Type and send a message | Message appears in chat |
| 22 | Press back from chat | Returns to Messages list |
| 23 | Open Settings (from Profile) | Settings screen opens |
| 24 | Background app → foreground | App resumes without crash or blank screen |
| 25 | Shake device / open dev menu | Dev menu opens (confirms Metro connection) |

---

*Generated from codebase inspection. No code was modified.*

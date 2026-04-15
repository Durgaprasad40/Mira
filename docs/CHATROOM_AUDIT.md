# Phase-2 Chat Rooms AUDIT REPORT

**Date**: 2026-03-01
**Status**: Feature Frozen
**Auditor**: Claude Opus 4.5

---

## 1. CRASH RISKS

### P0-CRASH-001: Missing `useState` import after OnlineUsersPanel refactor
- **File**: `components/chatroom/OnlineUsersPanel.tsx:1`
- **Symptom**: If someone re-adds search without restoring import, app crashes with "useState is not defined"
- **Reproduction**: Add `const [x, setX] = useState(...)` without importing useState
- **Error**: `ReferenceError: useState is not defined`
- **Status**: Currently safe (search removed), but fragile

### P1-CRASH-002: Animated.Value callback race condition
- **File**: `components/chatroom/UserProfilePopup.tsx:63-68`
- **Symptom**: `setBackdropActive(true)` may fire after component unmounts if animation completes during unmount
- **Reproduction**: Rapidly open/close popup while animation running
- **Error**: "Can't perform state update on unmounted component"
- **Mitigation**: Uses `visibleRef.current` check, but no `isMounted` guard

### P1-CRASH-003: SecureVideoPlayer player may be null
- **File**: `components/chatroom/SecureMediaViewer.tsx:84`
- **Symptom**: `if (!player) return null` guards render, but `useEffect` at line 59-71 accesses `player` without null check inside try block
- **Reproduction**: Pass invalid video URI, player creation fails
- **Error**: Caught by try/catch, but degraded UX

### P1-CRASH-004: convexRoom undefined vs null ambiguity
- **File**: `app/(main)/(private)/(tabs)/chat-rooms/[roomId].tsx:959-969`
- **Symptom**: Code correctly handles `undefined` (loading) vs `null` (not found), but if Convex returns unexpected value, UI may flash
- **Reproduction**: Network timeout during Convex query
- **Error**: Momentary "Room not found" flash before retry

### P2-CRASH-005: AsyncStorage JSON.parse without validation
- **File**: `app/(main)/(private)/(tabs)/chat-rooms/[roomId].tsx:853-866`
- **Symptom**: Already has try/catch for corrupted storage (CR-007), but other AsyncStorage reads (e.g., mute storage at line 506) lack similar protection
- **Reproduction**: Corrupt AsyncStorage key manually
- **Error**: `JSON.parse` exception

---

## 2. PERFORMANCE RISKS

### P1-PERF-001: FlatList using `ListHeaderComponent` with inline map() calls
- **File**: `app/(main)/(private)/(tabs)/chat-rooms/index.tsx:448-462`
- **Symptom**: `generalRooms.map()` and `languageRooms.map()` inside ListHeaderComponent re-run on every render
- **Reproduction**: Refresh room list repeatedly
- **Log**: No error, but unnecessary re-renders visible in React DevTools

### P1-PERF-002: OnlineUsersPanel sections computed with Date.now() in filter
- **File**: `components/chatroom/OnlineUsersPanel.tsx:76-103`
- **Symptom**: `Date.now()` called multiple times per filter iteration; not cached
- **Reproduction**: Open Users panel with 100+ users
- **Log**: No error, slight lag on low-end devices

### P2-PERF-003: `renderItem` useCallback has many dependencies
- **File**: `app/(main)/(private)/(tabs)/chat-rooms/[roomId].tsx:886-927`
- **Symptom**: `renderItem` recreated when any of 7 dependencies change, causing FlatList re-render
- **Reproduction**: Toggle mute on user while scrolling
- **Log**: FlatList may briefly flicker

### P2-PERF-004: buildListItems called on every messages change
- **File**: `app/(main)/(private)/(tabs)/chat-rooms/[roomId].tsx:389`
- **Symptom**: `useMemo` correctly used, but date separator IDs include timestamp which can cause key instability
- **Reproduction**: Send rapid messages
- **Log**: No error, minimal impact

### P2-PERF-005: PrivateChatView enrichedMessages recalculates on every message change
- **File**: `components/chatroom/PrivateChatView.tsx:209-217`
- **Symptom**: `shouldShowTimestamp` computed for ALL messages when one is added
- **Reproduction**: Send 50+ messages rapidly
- **Log**: Slight scroll jank on low-end devices

---

## 3. STATE/HYDRATION RISKS

### P1-STATE-001: Demo vs Convex mode `currentUserId` fallback
- **File**: `app/(main)/(private)/(tabs)/chat-rooms/[roomId].tsx:901`
- **Symptom**: `(isDemoMode ? DEMO_CURRENT_USER.id : authUserId)` - if `authUserId` is null in Convex mode, `isMe` check fails silently
- **Reproduction**: Open chat room before auth state hydrates
- **Log**: Own messages show as "other user" style

### P1-STATE-002: Store hydration fallback timeout
- **File**: `app/(main)/(private)/(tabs)/chat-rooms/[roomId].tsx:416-432`
- **Symptom**: 3-second fallback exists for demo store hydration, but if AsyncStorage is slow, messages may double-seed
- **Reproduction**: Clear app data, open room immediately
- **Log**: `[ChatRoom] Store hydration timeout - proceeding with demo seeding`

### P1-STATE-003: preferredRoomStore hydration race
- **File**: `app/(main)/(private)/(tabs)/chat-rooms/index.tsx:136-206`
- **Symptom**: `isPreferredLoading` checks `preferredHasHydrated`, but if store hydrates with stale roomId that no longer exists, redirect fails
- **Reproduction**: Delete preferred room from backend, reopen app
- **Log**: `[ChatRooms] Preferred room redirect failed`

### P2-STATE-004: Missing `senderAvatar` on message objects
- **File**: `app/(main)/(private)/(tabs)/chat-rooms/[roomId].tsx:617-626`
- **Symptom**: Demo messages created in `handleSend` don't include `senderAvatar` field (fixed for "me" but not for display)
- **Reproduction**: Already mitigated by recent fix using `persistedAvatarUri`
- **Status**: Fixed

### P2-STATE-005: `lastSeen` field may be undefined for some users
- **File**: `components/chatroom/OnlineUsersPanel.tsx:89-95`
- **Symptom**: Filter uses `u.lastSeen && now - u.lastSeen`, users without lastSeen are excluded from offline section
- **Reproduction**: New user with no lastSeen timestamp
- **Log**: User simply doesn't appear in offline list (expected but silent)

---

## 4. NAVIGATION RISKS

### P1-NAV-001: Redirect safety timeout may leave spinner stuck
- **File**: `app/(main)/(private)/(tabs)/chat-rooms/index.tsx:182-185`
- **Symptom**: 2-second safety timeout clears `isRedirecting`, but if navigation succeeds after timeout, UI may flash
- **Reproduction**: Very slow device, navigation takes >2 seconds
- **Log**: No error, brief flash of room list after entering room

### P1-NAV-002: `beforeRemove` listener on iOS may conflict with gestures
- **File**: `app/(main)/(private)/(tabs)/chat-rooms/[roomId].tsx:302-315`
- **Symptom**: Intercepts `GO_BACK` and `POP` to redirect to Deep Connect, but edge cases with tab switches may not be caught
- **Reproduction**: Swipe back while modal is open
- **Log**: Navigation may complete to wrong route momentarily

### P2-NAV-003: `hasRedirectedRef.current = false` on cleanup
- **File**: `app/(main)/(private)/(tabs)/chat-rooms/index.tsx:234-236`
- **Symptom**: useFocusEffect cleanup resets ref, allowing redirect on every focus, which is intended but could cause loops if preferredRoom keeps changing
- **Reproduction**: Backend updates preferredRoom rapidly
- **Log**: Multiple `[ChatRooms] Focus redirect to` logs in quick succession

### P2-NAV-004: router.replace with invalid roomId
- **File**: `app/(main)/(private)/(tabs)/chat-rooms/index.tsx:188, 231`
- **Symptom**: If `effectivePreferredRoomId` is malformed, router.replace may fail silently or show error screen
- **Reproduction**: Corrupted preferredRoomId in storage
- **Log**: Expo Router error or crash

---

## 5. MEDIA RISKS

### P1-MEDIA-001: SecureMediaViewer with empty mediaUri
- **File**: `components/chatroom/SecureMediaViewer.tsx:206`
- **Symptom**: `if (!visible || !mediaUri) return null` - safe, but no user feedback if mediaUri is empty
- **Reproduction**: Message with type='image' but no mediaUrl
- **Log**: Silent no-op, user sees nothing

### P1-MEDIA-002: Video player with invalid URI
- **File**: `components/chatroom/SecureMediaViewer.tsx:52-56`
- **Symptom**: `useVideoPlayer(mediaUri, ...)` - if URI is invalid, player may throw during creation
- **Reproduction**: Corrupted video URL, or URL with wrong content-type
- **Log**: Native crash or black screen

### P2-MEDIA-003: Image blurRadius transition not animated
- **File**: `components/chatroom/SecureMediaViewer.tsx:235-236`
- **Symptom**: `blurRadius={showMedia ? 0 : 50}` - instant switch, no smooth transition
- **Reproduction**: Hold/release on image
- **Log**: No error, jarring visual

### P2-MEDIA-004: expo-screen-capture dynamic import may fail silently
- **File**: `components/chatroom/SecureMediaViewer.tsx:166-174`
- **Symptom**: If `expo-screen-capture` is not installed, screenshot detection silently skipped
- **Reproduction**: Remove expo-screen-capture package
- **Log**: Caught error, no screenshot protection on Android

---

## 6. LOGGING RISKS

### P1-LOG-001: DEV console logs in production builds
- **Files**: Multiple (e.g., `[roomId].tsx:177`, `OnlineUsersPanel.tsx:97`)
- **Symptom**: All logs wrapped in `if (__DEV__)`, so safe. However, some logs are verbose:
  - `[TAP] avatar pressed` on every avatar tap
  - `[POPUP] backdrop press` on every backdrop touch
- **Reproduction**: Tap avatars rapidly in dev mode
- **Log**: Console spam, no production impact

### P2-LOG-002: Missing error logging in catch blocks
- **File**: `app/(main)/(private)/(tabs)/chat-rooms/[roomId].tsx:460-461`
- **Symptom**: `joinRoomMutation(...).catch(() => {})` - errors silently swallowed
- **Reproduction**: Backend rejects join (e.g., room full)
- **Log**: No error logged, user doesn't know join failed

### P2-LOG-003: `handleScreenshotDetected` logs missing
- **File**: `components/chatroom/SecureMediaViewer.tsx:186-204`
- **Symptom**: No DEV log when screenshot detected, harder to debug
- **Reproduction**: Take screenshot while holding media
- **Log**: Only ToastAndroid shown, no console log

---

## 7. OTHER RISKS

### P2-OTHER-001: Hardcoded DEMO_ONLINE_USERS
- **File**: `app/(main)/(private)/(tabs)/chat-rooms/[roomId].tsx:1009, 1127`
- **Symptom**: ActiveUsersStrip and OnlineUsersPanel always use `DEMO_ONLINE_USERS`, never real online users in Convex mode
- **Reproduction**: Use app in Convex mode
- **Log**: Shows demo users instead of real users

### P2-OTHER-002: `exitToHome` is a no-op
- **File**: `stores/chatRoomSessionStore.ts:91-95`
- **Symptom**: Function body is empty comment - does nothing. Caller must handle navigation separately.
- **Reproduction**: Call `exitToHome()`
- **Log**: No error, no effect

### P2-OTHER-003: Coin increment not validated
- **File**: `stores/chatRoomSessionStore.ts:137-141`
- **Symptom**: `incrementCoins` always adds +1, no rate limiting or validation
- **Reproduction**: Send 1000 messages rapidly
- **Log**: Coins can grow unbounded (demo mode only concern)

---

## SUMMARY

| Category | P0 | P1 | P2 |
|----------|----|----|------|
| Crash    | 0  | 4  | 1  |
| Perf     | 0  | 2  | 3  |
| State    | 0  | 3  | 2  |
| Nav      | 0  | 2  | 2  |
| Media    | 0  | 2  | 2  |
| Logging  | 0  | 1  | 2  |
| Other    | 0  | 0  | 3  |
| **Total**| **0** | **14** | **15** |

---

**NO FIXES APPLIED**

# LOCKS.md

This file records locked areas of the codebase that must not be modified without explicit authorization.

---

## LOCKED: Full Onboarding Flow

- **Scope:** `app/(onboarding)/**`
- **Locked by:** Durgaprasad
- **Date:** 2026-02-24
- **Rule:** No changes allowed unless Durgaprasad explicitly unlocks (says "UNLOCK onboarding" or names a specific file).
- **Includes:** All screens, routes, UI, logic, styles, navigation, and behavior within the onboarding directory.

---

## LOCKED: Keyboard Behavior (Global)

- **Scope:** All keyboard-related behavior across the entire codebase
- **Locked by:** Durgaprasad
- **Date:** 2026-02-24
- **Rule:** Do not modify any keyboard handling, KeyboardAvoidingView props, keyboard listeners, or keyboard-related styling.
- **Note:** Onboarding inherits this global lock.

---

*To request an unlock, Durgaprasad must explicitly state the unlock in a message.*

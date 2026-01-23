# Mira App - Implementation Gaps & Required Refinements

Based on the detailed plan documents, here are the specific gaps and required refinements:

## 🔴 Critical Gaps

### 1. Subscription Tiers & Pricing
**Required:**
- **Basic Tier** (₹100/month, ₹500/3mo, ₹1000/year)
- **Premium Tier** (₹200/month, ₹500/3mo, ₹1500/year)
- Currently only has "premium" tier with USD pricing

**Action:** Update subscription system to support:
- Basic vs Premium tiers
- Indian Rupee (₹) pricing
- Multiple duration options (1 month, 3 months, 1 year)

### 2. Gender-Based Feature Gating
**Required:**
- **Women**: Full FREE access to ALL features
- **Men**: Tiered access (Free Week 1, Free After Week 1, Basic, Premium)

**Current Issue:** No gender-based logic implemented

**Action:** Implement:
- Gender detection in feature access checks
- Women get unlimited everything
- Men follow tier restrictions

### 3. Swipe Limits & Quotas
**Required:**
- Men Free: 50 swipes/day, 0-1 Super Like/week (after week 1)
- Men Basic: Unlimited swipes, 5 Super Likes/week
- Men Premium: Unlimited everything
- Women: Unlimited everything

**Action:** Add daily/weekly quota tracking:
- Daily swipe counter
- Weekly Super Like counter
- Reset logic for quotas

### 4. Pre-Match Message Quotas
**Required:**
- Men Free Week 1: 5 messages/week
- Men Free After Week 1: 0 messages/week
- Men Basic: 10 messages/week
- Men Premium: Unlimited
- Women: Unlimited

**Action:** Implement weekly message quota system

### 5. Free Trial System (Men Only)
**Required:**
- First 7 days after signup
- Features: 5 pre-match messages, 50 swipes/day, 1 Super Like
- After trial: Restricted free tier

**Action:** Add trial tracking and expiration logic

### 6. Swipe Mechanics Refinements
**Required:**
- Threshold: 30% screen width for left/right ✅ (implemented)
- Threshold: 20% screen height for up ❌ (needs verification)
- Haptic feedback ❌ (missing)
- Icon growth animation ❌ (needs enhancement)
- Color overlay during drag ❌ (needs enhancement)

**Action:** Enhance swipe animations and feedback

### 7. Incognito Mode Tiers
**Required:**
- Women: Full incognito
- Men Free: Limited (profile visible to some)
- Men Basic: Partial (hidden from non-matches, visible to Super Likers)
- Men Premium: Full incognito

**Action:** Implement tiered incognito logic

### 8. "See Who Liked You" Feature
**Required:**
- Men Free: Blurred preview
- Men Basic/Premium: Full view
- Women: Full view

**Action:** Implement blurred preview for free tier men

### 9. Message Templates
**Required:**
- 10-50+ templates based on subscription tier
- Custom messages: Basic (150 char limit), Premium (unlimited)

**Action:** Create template system with tier-based access

### 10. Boost System
**Required:**
- Men Free: 0 boosts/month
- Men Basic: 2 boosts/month
- Men Premium: Unlimited
- Women: All boosts available

**Action:** Implement boost purchase and usage tracking

## 🟡 Missing Features

### 11. Crossed Paths Feature
**Status:** Backend exists, UI incomplete
**Required:**
- Track location when "Always" permission granted
- Record encounters (same area, different times)
- 10+ crossings = 48hr free unlimited messaging
- Privacy: Never show exact location

**Action:** Complete UI implementation

### 12. Truth or Dare Feature
**Status:** Backend exists, UI incomplete
**Required:**
- Browse anonymously
- Send dares to profiles
- Dare accepted = Both identities revealed + Match

**Action:** Complete UI implementation

### 13. Typing Indicators
**Required:** Real-time typing indicators in chat
**Status:** Not implemented

### 14. Read Receipts
**Required:** Show read status for messages
**Status:** Partially implemented, needs verification

### 15. Match Celebration Screen
**Required:** Special screen when mutual match occurs
**Status:** Not implemented

### 16. Profile Boost UI
**Required:** UI to purchase and activate boosts
**Status:** Not implemented

### 17. Weekly Message Quota Display
**Required:** Show remaining messages in messages tab
**Status:** Needs enhancement

## 🟢 Needs Refinement

### 18. Explore Screen Filters
**Required:**
- Relationship Intent: OR logic (any selected) ✅
- Activities: OR logic (any selected) ✅
- Combined: Intent AND Activities ✅
- Real-time count updates ✅

**Status:** Mostly complete, verify logic

### 19. Payment Integration
**Required:**
- RevenueCat for subscription management
- Razorpay for Indian payments (₹)
- Apple/Google in-app purchases

**Status:** Placeholder only, needs actual integration

### 20. Face Verification
**Required:** Third-party API integration (AWS Rekognition or similar)
**Status:** UI exists, backend integration missing

### 21. NSFW Photo Filter
**Required:** Filter on upload
**Status:** Not implemented

### 22. Profanity Filter
**Required:** For bios and messages
**Status:** Not implemented

### 23. Trust Score System
**Required:** User trust/reputation scoring
**Status:** Not implemented

## 📋 Implementation Priority

### Phase 1 (Critical - Week 1)
1. Gender-based feature gating
2. Subscription tiers (Basic/Premium with ₹ pricing)
3. Swipe limits & quotas
4. Pre-match message quotas
5. Free trial system

### Phase 2 (High Priority - Week 2)
6. Swipe mechanics refinements (haptics, animations)
7. Incognito mode tiers
8. "See Who Liked You" with blur
9. Message templates system
10. Boost system

### Phase 3 (Medium Priority - Week 3)
11. Crossed Paths UI completion
12. Truth or Dare UI completion
13. Typing indicators
14. Match celebration screen
15. Profile boost UI

### Phase 4 (Polish - Week 4)
16. Payment integration (RevenueCat, Razorpay)
17. Face verification API integration
18. NSFW filter
19. Profanity filter
20. Trust score system

## 🔍 Files That Need Updates

1. `lib/constants.ts` - Add subscription tier definitions, pricing
2. `convex/subscriptions.ts` - Add Basic tier, ₹ pricing, trial logic
3. `convex/likes.ts` - Add quota checking for swipes and Super Likes
4. `convex/messages.ts` - Add weekly quota checking
5. `stores/subscriptionStore.ts` - Add tier management
6. `app/(main)/(tabs)/discover.tsx` - Add haptic feedback, enhance animations
7. `components/cards/ProfileCard.tsx` - Add color overlay, icon growth
8. `app/(main)/(tabs)/messages.tsx` - Add weekly quota display
9. `app/(main)/subscription.tsx` - Update with Basic/Premium tiers, ₹ pricing
10. `hooks/useMessageQuota.ts` - Implement quota tracking

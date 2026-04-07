/**
 * DEBUG SCRIPT: Analyze Explore eligibility for all candidate users
 * Run with: npx convex run scripts/debugExploreEligibility:analyzeEligibility
 */
import { query } from '../_generated/server';
import { v } from 'convex/values';

function calculateAge(dateOfBirth: string): number {
  if (!dateOfBirth) return 0;
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  if (isNaN(birthDate.getTime())) return 0;
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function isUserPaused(user: any): boolean {
  return (
    user.isDiscoveryPaused === true &&
    typeof user.discoveryPausedUntil === 'number' &&
    user.discoveryPausedUntil > Date.now()
  );
}

export const analyzeEligibility = query({
  args: {
    viewerAuthId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const cooldownThreshold = now - COOLDOWN_MS;
    const passExpiry = now - 7 * 24 * 60 * 60 * 1000;

    // Find the viewer (use provided ID or find first active user)
    let viewer: any = null;
    if (args.viewerAuthId) {
      viewer = await ctx.db
        .query('users')
        .withIndex('by_auth_user_id', (q) => q.eq('authUserId', args.viewerAuthId))
        .first();
    }
    if (!viewer) {
      // Default to first active user (likely the logged-in test user)
      const allUsers = await ctx.db.query('users').filter(q => q.eq(q.field('isActive'), true)).collect();
      viewer = allUsers[0];
    }

    if (!viewer) {
      return { error: 'No viewer found' };
    }

    const viewerId = viewer._id;
    const viewerAge = calculateAge(viewer.dateOfBirth);

    console.log('='.repeat(80));
    console.log('EXPLORE ELIGIBILITY DEBUG REPORT');
    console.log('='.repeat(80));
    console.log(`\nVIEWER: ${viewer.name} (${viewer._id})`);
    console.log(`  Gender: ${viewer.gender}`);
    console.log(`  Looking for: ${JSON.stringify(viewer.lookingFor)}`);
    console.log(`  Age: ${viewerAge}`);
    console.log(`  Age range: ${viewer.minAge}-${viewer.maxAge}`);
    console.log(`  Location: ${viewer.latitude?.toFixed(2)}, ${viewer.longitude?.toFixed(2)}`);
    console.log(`  Max distance: ${viewer.maxDistance}km`);
    console.log(`  Subscription: ${viewer.subscriptionTier || 'free'}`);

    // Build exclusion sets
    const [
      mySwipes,
      matchesAsUser1,
      matchesAsUser2,
      blocksICreated,
      blocksAgainstMe,
      myReports,
      myConversationParticipations,
    ] = await Promise.all([
      ctx.db.query('likes').withIndex('by_from_user', (q) => q.eq('fromUserId', viewerId)).collect(),
      ctx.db.query('matches').withIndex('by_user1', (q) => q.eq('user1Id', viewerId)).filter((q) => q.eq(q.field('isActive'), true)).collect(),
      ctx.db.query('matches').withIndex('by_user2', (q) => q.eq('user2Id', viewerId)).filter((q) => q.eq(q.field('isActive'), true)).collect(),
      ctx.db.query('blocks').withIndex('by_blocker', (q) => q.eq('blockerId', viewerId)).collect(),
      ctx.db.query('blocks').withIndex('by_blocked', (q) => q.eq('blockedUserId', viewerId)).collect(),
      ctx.db.query('reports').withIndex('by_reporter', (q) => q.eq('reporterId', viewerId)).collect(),
      ctx.db.query('conversationParticipants').withIndex('by_user', (q) => q.eq('userId', viewerId)).collect(),
    ]);

    const swipedUserIds = new Set<string>();
    for (const swipe of mySwipes) {
      if (swipe.action === 'pass' && swipe.createdAt < passExpiry) continue;
      swipedUserIds.add(swipe.toUserId as string);
    }

    const matchedUserIds = new Set<string>();
    for (const m of matchesAsUser1) matchedUserIds.add(m.user2Id as string);
    for (const m of matchesAsUser2) matchedUserIds.add(m.user1Id as string);

    const blockedUserIds = new Set<string>();
    for (const b of blocksICreated) blockedUserIds.add(b.blockedUserId as string);
    for (const b of blocksAgainstMe) blockedUserIds.add(b.blockerId as string);

    const viewerReportedIds = new Set<string>();
    for (const report of myReports) viewerReportedIds.add(report.reportedUserId as string);

    const conversationPartnerIds = new Set<string>();
    if (myConversationParticipations.length > 0) {
      const conversations = await Promise.all(
        myConversationParticipations.map((p) => ctx.db.get(p.conversationId))
      );
      for (const conv of conversations) {
        if (!conv) continue;
        for (const participantId of conv.participants) {
          if (participantId !== viewerId) {
            conversationPartnerIds.add(participantId as string);
          }
        }
      }
    }

    console.log(`\nVIEWER EXCLUSION SETS:`);
    console.log(`  Swiped: ${swipedUserIds.size} users`);
    console.log(`  Matched: ${matchedUserIds.size} users`);
    console.log(`  Blocked: ${blockedUserIds.size} users`);
    console.log(`  Reported: ${viewerReportedIds.size} users`);
    console.log(`  Conversation partners: ${conversationPartnerIds.size} users`);

    // Get all users with assigned categories
    const allUsers = await ctx.db.query('users').collect();
    const candidateUsers = allUsers.filter(u => u.assignedDiscoverCategory);

    console.log(`\n${'='.repeat(80)}`);
    console.log(`CANDIDATE USERS WITH ASSIGNED CATEGORIES: ${candidateUsers.length}`);
    console.log('='.repeat(80));

    const results: any[] = [];

    for (const user of candidateUsers) {
      const reasons: string[] = [];
      let eligible = true;

      const userAge = calculateAge(user.dateOfBirth);
      let distance: number | undefined;
      if (viewer.latitude && viewer.longitude && user.latitude && user.longitude) {
        distance = calculateDistance(viewer.latitude, viewer.longitude, user.latitude, user.longitude);
      }

      // Check each eligibility criterion
      const checks = {
        isSelf: user._id === viewerId,
        isActive: user.isActive,
        isBanned: user.isBanned,
        isPaused: isUserPaused(user),
        isIncognito: user.incognitoMode,
        canSeeIncognito: viewer.gender === 'female' || viewer.subscriptionTier === 'premium',
        viewerLookingFor: viewer.lookingFor,
        userGender: user.gender,
        viewerGenderMatch: viewer.lookingFor?.includes(user.gender),
        userLookingFor: user.lookingFor,
        viewerGender: viewer.gender,
        userGenderMatch: user.lookingFor?.includes(viewer.gender),
        userAge,
        viewerMinAge: viewer.minAge,
        viewerMaxAge: viewer.maxAge,
        userInViewerAgeRange: userAge >= (viewer.minAge || 0) && userAge <= (viewer.maxAge || 100),
        viewerAge,
        userMinAge: user.minAge,
        userMaxAge: user.maxAge,
        viewerInUserAgeRange: viewerAge >= (user.minAge || 0) && viewerAge <= (user.maxAge || 100),
        distance,
        viewerMaxDistance: viewer.maxDistance,
        distanceOk: distance === undefined || distance <= (viewer.maxDistance || 9999),
        alreadySwiped: swipedUserIds.has(user._id as string),
        alreadyMatched: matchedUserIds.has(user._id as string),
        alreadyBlocked: blockedUserIds.has(user._id as string),
        alreadyReported: viewerReportedIds.has(user._id as string),
        inConversation: conversationPartnerIds.has(user._id as string),
        lastShownAt: user.lastShownInDiscoverAt,
        inCooldown: user.lastShownInDiscoverAt && user.lastShownInDiscoverAt > cooldownThreshold,
        verificationLevel: user.verificationEnforcementLevel,
      };

      // Determine exclusion reasons
      if (checks.isSelf) { reasons.push('SELF'); eligible = false; }
      if (!checks.isActive) { reasons.push('NOT_ACTIVE'); eligible = false; }
      if (checks.isBanned) { reasons.push('BANNED'); eligible = false; }
      if (checks.isPaused) { reasons.push('PAUSED'); eligible = false; }
      if (checks.isIncognito && !checks.canSeeIncognito) { reasons.push('INCOGNITO'); eligible = false; }
      if (!checks.viewerGenderMatch) { reasons.push(`VIEWER_GENDER_PREF (viewer wants ${JSON.stringify(checks.viewerLookingFor)}, user is ${checks.userGender})`); eligible = false; }
      if (!checks.userGenderMatch) { reasons.push(`USER_GENDER_PREF (user wants ${JSON.stringify(checks.userLookingFor)}, viewer is ${checks.viewerGender})`); eligible = false; }
      if (!checks.userInViewerAgeRange && checks.userAge > 0) { reasons.push(`VIEWER_AGE_PREF (user age ${checks.userAge}, viewer range ${checks.viewerMinAge}-${checks.viewerMaxAge})`); eligible = false; }
      if (!checks.viewerInUserAgeRange && checks.viewerAge > 0) { reasons.push(`USER_AGE_PREF (viewer age ${checks.viewerAge}, user range ${checks.userMinAge}-${checks.userMaxAge})`); eligible = false; }
      if (!checks.distanceOk) { reasons.push(`DISTANCE (${checks.distance}km > ${checks.viewerMaxDistance}km)`); eligible = false; }
      if (checks.alreadySwiped) { reasons.push('ALREADY_SWIPED'); eligible = false; }
      if (checks.alreadyMatched) { reasons.push('ALREADY_MATCHED'); eligible = false; }
      if (checks.alreadyBlocked) { reasons.push('BLOCKED'); eligible = false; }
      if (checks.alreadyReported) { reasons.push('REPORTED'); eligible = false; }
      if (checks.inConversation) { reasons.push('IN_CONVERSATION'); eligible = false; }
      if (checks.inCooldown) { reasons.push('COOLDOWN'); eligible = false; }
      if (checks.verificationLevel === 'security_only') { reasons.push('SECURITY_ONLY'); eligible = false; }

      if (reasons.length === 0) {
        reasons.push('ELIGIBLE');
      }

      const result = {
        userId: user._id,
        name: user.name,
        category: user.assignedDiscoverCategory,
        eligible,
        reasons,
        checks,
      };
      results.push(result);

      console.log(`\n--- ${user.name} (${user._id}) ---`);
      console.log(`  Category: ${user.assignedDiscoverCategory}`);
      console.log(`  Gender: ${user.gender} | Looking for: ${JSON.stringify(user.lookingFor)}`);
      console.log(`  Age: ${userAge} | Age range: ${user.minAge}-${user.maxAge}`);
      console.log(`  Active: ${user.isActive} | Banned: ${user.isBanned} | Paused: ${checks.isPaused}`);
      console.log(`  Incognito: ${user.incognitoMode} | Verification: ${user.verificationEnforcementLevel || 'none'}`);
      console.log(`  Distance: ${distance ?? 'N/A'}km | Max: ${viewer.maxDistance}km`);
      console.log(`  Swiped: ${checks.alreadySwiped} | Matched: ${checks.alreadyMatched} | Conversation: ${checks.inConversation}`);
      console.log(`  Blocked: ${checks.alreadyBlocked} | Reported: ${checks.alreadyReported} | Cooldown: ${checks.inCooldown}`);
      console.log(`  >>> RESULT: ${eligible ? '✅ ELIGIBLE' : '❌ EXCLUDED'}`);
      console.log(`  >>> REASONS: ${reasons.join(', ')}`);
    }

    // Summary
    const eligibleUsers = results.filter(r => r.eligible);
    const excludedUsers = results.filter(r => !r.eligible);

    console.log(`\n${'='.repeat(80)}`);
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total candidates: ${results.length}`);
    console.log(`Eligible: ${eligibleUsers.length}`);
    console.log(`Excluded: ${excludedUsers.length}`);

    // Group by exclusion reason
    const reasonCounts: Record<string, number> = {};
    for (const r of excludedUsers) {
      for (const reason of r.reasons) {
        const key = reason.split(' (')[0]; // Strip details
        reasonCounts[key] = (reasonCounts[key] || 0) + 1;
      }
    }
    console.log(`\nExclusion reasons breakdown:`);
    for (const [reason, count] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reason}: ${count}`);
    }

    // Suggest which users would be visible if filters relaxed
    console.log(`\n${'='.repeat(80)}`);
    console.log('POTENTIAL FIXES');
    console.log('='.repeat(80));

    const nonSelfUsers = results.filter(r => !r.checks.isSelf);
    for (const r of nonSelfUsers) {
      const fixableReasons = r.reasons.filter((reason: string) =>
        reason.includes('SWIPED') ||
        reason.includes('MATCHED') ||
        reason.includes('CONVERSATION') ||
        reason.includes('GENDER_PREF') ||
        reason.includes('AGE_PREF')
      );
      if (fixableReasons.length > 0 && fixableReasons.length === r.reasons.length) {
        console.log(`\n${r.name} would be visible if:`);
        for (const reason of fixableReasons) {
          console.log(`  - Fix: ${reason}`);
        }
      }
    }

    return {
      viewer: {
        id: viewer._id,
        name: viewer.name,
        gender: viewer.gender,
        lookingFor: viewer.lookingFor,
        age: viewerAge,
        ageRange: [viewer.minAge, viewer.maxAge],
      },
      exclusionSets: {
        swiped: swipedUserIds.size,
        matched: matchedUserIds.size,
        blocked: blockedUserIds.size,
        reported: viewerReportedIds.size,
        conversations: conversationPartnerIds.size,
      },
      candidates: results,
      summary: {
        total: results.length,
        eligible: eligibleUsers.length,
        excluded: excludedUsers.length,
        reasonCounts,
      },
    };
  },
});

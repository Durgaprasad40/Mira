/**
 * Admin utility functions for backend cleanup and maintenance
 *
 * SAFETY: These functions should only be called by developers/admins
 * DO NOT expose these to client-side code
 */

import { internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { Id } from './_generated/dataModel';
import { internal } from './_generated/api';

/**
 * Reset ALL users in the database
 *
 * Deletes ALL users and their related data, while preserving global/core data.
 *
 * PRESERVES (does NOT delete):
 * - chatRooms (public rooms like Global, Hindi, Telugu, etc.)
 * - system configs
 * - ToD prompt seeds
 * - confession prompt seeds
 * - any other global seed data
 *
 * DELETES:
 * - All users
 * - All user-related data (photos, likes, matches, messages, etc.)
 *
 * Safety features:
 * - Dry run mode to preview what would be deleted
 * - Idempotent: can be run multiple times safely
 *
 * @param dryRun - If true, only logs what would be deleted without actually deleting
 *
 * Usage:
 *   DRY RUN:  npx convex run admin:resetAllUsers '{"dryRun": true}'
 *   EXECUTE:  npx convex run admin:resetAllUsers '{"dryRun": false}'
 */
export const resetAllUsers = internalMutation({
  args: {
    dryRun: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { dryRun } = args;

    console.log('='.repeat(80));
    console.log(`DATABASE RESET - ${dryRun ? 'DRY RUN' : 'EXECUTE'} MODE`);
    console.log('Deleting ALL users and related data');
    console.log('Preserving: chatRooms, system configs, global seed data');
    console.log('='.repeat(80));

    // ============================================================================
    // STEP 1: Find all users
    // ============================================================================
    const allUsers = await ctx.db.query('users').collect();

    console.log(`\n[DISCOVERY] Total users in DB: ${allUsers.length}`);

    if (allUsers.length === 0) {
      console.log('\n[RESULT] No users to delete. Database already empty.');
      return {
        mode: dryRun ? 'DRY_RUN' : 'EXECUTE',
        totalUsers: 0,
        usersDeleted: 0,
        summary: 'No users to delete',
      };
    }

    // Log users that will be deleted
    console.log('\n[USERS TO DELETE]');
    for (const user of allUsers) {
      console.log(`  - ${user.name} (${user.email || 'no email'}, ID: ${user._id})`);
    }

    if (dryRun) {
      console.log('\n[DRY RUN] Skipping actual deletion. Use dryRun=false to execute.');
      return {
        mode: 'DRY_RUN',
        totalUsers: allUsers.length,
        usersToDelete: allUsers.length,
        userIds: allUsers.map((u) => u._id),
      };
    }

    // ============================================================================
    // STEP 2: Delete related data for each user
    // Helper function to check if a record belongs to users being deleted
    // ============================================================================
    const userIds = new Set(allUsers.map((u) => u._id));
    const isUserToDelete = (id: Id<'users'>) => userIds.has(id);

    console.log('\n[DELETION] Starting cleanup...');

    const deletionStats = {
      users: 0,
      photos: 0,
      likes: 0,
      matches: 0,
      conversations: 0,
      messages: 0,
      media: 0,
      mediaPermissions: 0,
      notifications: 0,
      crossedPaths: 0,
      crossPathHistory: 0,
      reports: 0,
      blocks: 0,
      sessions: 0,
      typingStatus: 0,
      nudges: 0,
      verificationSessions: 0,
      deviceFingerprints: 0,
      behaviorFlags: 0,
      userStrikes: 0,
      userPrivateProfiles: 0,
      revealRequests: 0,
      confessions: 0,
      confessionReplies: 0,
      confessionReactions: 0,
      confessionReports: 0,
      confessionNotifications: 0,
      chatRoomMembers: 0,
      chatRoomMessages: 0,
      chatRoomPenalties: 0,
      chatRoomJoinRequests: 0,
      chatRoomBans: 0,
      filterPresets: 0,
      crossedEvents: 0,
      chatTodGames: 0,
      privateDeletionStates: 0,
      securityEvents: 0,
      mediaReports: 0,
      surveyResponses: 0,
      moderationQueue: 0,
      purchases: 0,
      subscriptionRecords: 0,
    };

    console.log('[DELETION] Collecting all user-related records...');

    // Photos
    const allPhotos = await ctx.db.query('photos').collect();
    for (const photo of allPhotos) {
      if (isUserToDelete(photo.userId)) {
        await ctx.db.delete(photo._id);
        deletionStats.photos++;
      }
    }
    console.log(`  - Processed photos: ${deletionStats.photos} deleted`);

    // Likes (fromUserId or toUserId)
    const allLikes = await ctx.db.query('likes').collect();
    for (const like of allLikes) {
      if (isUserToDelete(like.fromUserId) || isUserToDelete(like.toUserId)) {
        await ctx.db.delete(like._id);
        deletionStats.likes++;
      }
    }
    console.log(`  - Processed likes: ${deletionStats.likes} deleted`);

    // Matches
    const allMatches = await ctx.db.query('matches').collect();
    for (const match of allMatches) {
      if (isUserToDelete(match.user1Id) || isUserToDelete(match.user2Id)) {
        await ctx.db.delete(match._id);
        deletionStats.matches++;
      }
    }
    console.log(`  - Processed matches: ${deletionStats.matches} deleted`);

    // Conversations (check participants array) and their messages
    const allConversations = await ctx.db.query('conversations').collect();
    const conversationsToDelete: Id<'conversations'>[] = [];
    for (const conv of allConversations) {
      const hasUserToDelete = conv.participants.some((id) => isUserToDelete(id));
      if (hasUserToDelete) {
        conversationsToDelete.push(conv._id);
        await ctx.db.delete(conv._id);
        deletionStats.conversations++;
      }
    }

    // Delete messages in these conversations
    const allMessages = await ctx.db.query('messages').collect();
    for (const msg of allMessages) {
      if (conversationsToDelete.includes(msg.conversationId)) {
        await ctx.db.delete(msg._id);
        deletionStats.messages++;
      }
    }
    console.log(`  - Processed conversations: ${deletionStats.conversations} deleted, ${deletionStats.messages} messages deleted`);

    // Media (check ownerId)
    const allMedia = await ctx.db.query('media').collect();
    for (const media of allMedia) {
      if (isUserToDelete(media.ownerId)) {
        await ctx.db.delete(media._id);
        deletionStats.media++;
      }
    }
    console.log(`  - Processed media: ${deletionStats.media} deleted`);

    // Media permissions (check senderId and recipientId)
    const allMediaPerms = await ctx.db.query('mediaPermissions').collect();
    for (const perm of allMediaPerms) {
      if (isUserToDelete(perm.senderId) || isUserToDelete(perm.recipientId)) {
        await ctx.db.delete(perm._id);
        deletionStats.mediaPermissions++;
      }
    }
    console.log(`  - Processed media permissions: ${deletionStats.mediaPermissions} deleted`);

    // Security events (check actorId)
    const allSecurityEvents = await ctx.db.query('securityEvents').collect();
    for (const event of allSecurityEvents) {
      if (isUserToDelete(event.actorId)) {
        await ctx.db.delete(event._id);
        deletionStats.securityEvents++;
      }
    }

    // Media reports
    const allMediaReports = await ctx.db.query('mediaReports').collect();
    for (const report of allMediaReports) {
      if (isUserToDelete(report.reporterId)) {
        await ctx.db.delete(report._id);
        deletionStats.mediaReports++;
      }
    }
    console.log(`  - Processed security events: ${deletionStats.securityEvents}, media reports: ${deletionStats.mediaReports}`);

    // Notifications
    const allNotifications = await ctx.db.query('notifications').collect();
    for (const notif of allNotifications) {
      if (isUserToDelete(notif.userId)) {
        await ctx.db.delete(notif._id);
        deletionStats.notifications++;
      }
    }
    console.log(`  - Processed notifications: ${deletionStats.notifications} deleted`);

    // Crossed paths
    const allCrossedPaths = await ctx.db.query('crossedPaths').collect();
    for (const cp of allCrossedPaths) {
      if (isUserToDelete(cp.user1Id) || isUserToDelete(cp.user2Id)) {
        await ctx.db.delete(cp._id);
        deletionStats.crossedPaths++;
      }
    }

    // Cross path history (check user1Id and user2Id)
    const allCrossHistory = await ctx.db.query('crossPathHistory').collect();
    for (const ch of allCrossHistory) {
      if (isUserToDelete(ch.user1Id) || isUserToDelete(ch.user2Id)) {
        await ctx.db.delete(ch._id);
        deletionStats.crossPathHistory++;
      }
    }

    // Crossed events
    const allCrossedEvents = await ctx.db.query('crossedEvents').collect();
    for (const event of allCrossedEvents) {
      if (isUserToDelete(event.userId)) {
        await ctx.db.delete(event._id);
        deletionStats.crossedEvents++;
      }
    }
    console.log(`  - Processed crossed paths: ${deletionStats.crossedPaths}, history: ${deletionStats.crossPathHistory}, events: ${deletionStats.crossedEvents}`);

    // Reports
    const allReports = await ctx.db.query('reports').collect();
    for (const report of allReports) {
      if (isUserToDelete(report.reporterId) || isUserToDelete(report.reportedUserId)) {
        await ctx.db.delete(report._id);
        deletionStats.reports++;
      }
    }

    // Blocks
    const allBlocks = await ctx.db.query('blocks').collect();
    for (const block of allBlocks) {
      if (isUserToDelete(block.blockerId) || isUserToDelete(block.blockedUserId)) {
        await ctx.db.delete(block._id);
        deletionStats.blocks++;
      }
    }
    console.log(`  - Processed reports: ${deletionStats.reports}, blocks: ${deletionStats.blocks}`);

    // Sessions
    const allSessions = await ctx.db.query('sessions').collect();
    for (const session of allSessions) {
      if (isUserToDelete(session.userId)) {
        await ctx.db.delete(session._id);
        deletionStats.sessions++;
      }
    }
    console.log(`  - Processed sessions: ${deletionStats.sessions}`);

    // Typing status
    const allTyping = await ctx.db.query('typingStatus').collect();
    for (const t of allTyping) {
      if (isUserToDelete(t.userId)) {
        await ctx.db.delete(t._id);
        deletionStats.typingStatus++;
      }
    }

    // Nudges
    const allNudges = await ctx.db.query('nudges').collect();
    for (const nudge of allNudges) {
      if (isUserToDelete(nudge.userId)) {
        await ctx.db.delete(nudge._id);
        deletionStats.nudges++;
      }
    }

    // Survey responses
    const allSurveyResponses = await ctx.db.query('surveyResponses').collect();
    for (const response of allSurveyResponses) {
      if (response.userId && isUserToDelete(response.userId)) {
        await ctx.db.delete(response._id);
        deletionStats.surveyResponses++;
      }
    }
    console.log(`  - Processed typing: ${deletionStats.typingStatus}, nudges: ${deletionStats.nudges}, surveys: ${deletionStats.surveyResponses}`);

    // Verification sessions
    const allVerificationSessions = await ctx.db.query('verificationSessions').collect();
    for (const vs of allVerificationSessions) {
      if (isUserToDelete(vs.userId)) {
        await ctx.db.delete(vs._id);
        deletionStats.verificationSessions++;
      }
    }

    // Device fingerprints
    const allFingerprints = await ctx.db.query('deviceFingerprints').collect();
    for (const fp of allFingerprints) {
      if (fp.userId && isUserToDelete(fp.userId)) {
        await ctx.db.delete(fp._id);
        deletionStats.deviceFingerprints++;
      }
    }

    // Behavior flags
    const allBehaviorFlags = await ctx.db.query('behaviorFlags').collect();
    for (const bf of allBehaviorFlags) {
      if (isUserToDelete(bf.userId)) {
        await ctx.db.delete(bf._id);
        deletionStats.behaviorFlags++;
      }
    }

    // Moderation queue
    const allModerationQueue = await ctx.db.query('moderationQueue').collect();
    for (const mq of allModerationQueue) {
      if (mq.reporterId && isUserToDelete(mq.reporterId)) {
        await ctx.db.delete(mq._id);
        deletionStats.moderationQueue++;
      }
    }

    // User strikes
    const allStrikes = await ctx.db.query('userStrikes').collect();
    for (const strike of allStrikes) {
      if (isUserToDelete(strike.userId)) {
        await ctx.db.delete(strike._id);
        deletionStats.userStrikes++;
      }
    }
    console.log(`  - Processed verification: ${deletionStats.verificationSessions}, fingerprints: ${deletionStats.deviceFingerprints}, strikes: ${deletionStats.userStrikes}`);

    // Subscription records
    const allSubscriptionRecords = await ctx.db.query('subscriptionRecords').collect();
    for (const sub of allSubscriptionRecords) {
      if (isUserToDelete(sub.userId)) {
        await ctx.db.delete(sub._id);
        deletionStats.subscriptionRecords++;
      }
    }

    // Purchases
    const allPurchases = await ctx.db.query('purchases').collect();
    for (const purchase of allPurchases) {
      if (isUserToDelete(purchase.userId)) {
        await ctx.db.delete(purchase._id);
        deletionStats.purchases++;
      }
    }
    console.log(`  - Processed subscriptions: ${deletionStats.subscriptionRecords}, purchases: ${deletionStats.purchases}`);

    // User private profiles
    const allPrivateProfiles = await ctx.db.query('userPrivateProfiles').collect();
    for (const pp of allPrivateProfiles) {
      if (isUserToDelete(pp.userId)) {
        await ctx.db.delete(pp._id);
        deletionStats.userPrivateProfiles++;
      }
    }

    // Reveal requests
    const allRevealRequests = await ctx.db.query('revealRequests').collect();
    for (const reveal of allRevealRequests) {
      if (isUserToDelete(reveal.fromUserId) || isUserToDelete(reveal.toUserId)) {
        await ctx.db.delete(reveal._id);
        deletionStats.revealRequests++;
      }
    }
    console.log(`  - Processed private profiles: ${deletionStats.userPrivateProfiles}, reveal requests: ${deletionStats.revealRequests}`);

    // Confessions
    const allConfessions = await ctx.db.query('confessions').collect();
    for (const confession of allConfessions) {
      if (confession.userId && isUserToDelete(confession.userId)) {
        await ctx.db.delete(confession._id);
        deletionStats.confessions++;
      }
    }

    // Confession replies
    const allConfessionReplies = await ctx.db.query('confessionReplies').collect();
    for (const reply of allConfessionReplies) {
      if (reply.userId && isUserToDelete(reply.userId)) {
        await ctx.db.delete(reply._id);
        deletionStats.confessionReplies++;
      }
    }

    // Confession reactions
    const allConfessionReactions = await ctx.db.query('confessionReactions').collect();
    for (const reaction of allConfessionReactions) {
      if (isUserToDelete(reaction.userId)) {
        await ctx.db.delete(reaction._id);
        deletionStats.confessionReactions++;
      }
    }

    // Confession reports
    const allConfessionReports = await ctx.db.query('confessionReports').collect();
    for (const report of allConfessionReports) {
      if (isUserToDelete(report.reporterId)) {
        await ctx.db.delete(report._id);
        deletionStats.confessionReports++;
      }
    }

    // Confession notifications
    const allConfessionNotifs = await ctx.db.query('confessionNotifications').collect();
    for (const notif of allConfessionNotifs) {
      if (isUserToDelete(notif.userId)) {
        await ctx.db.delete(notif._id);
        deletionStats.confessionNotifications++;
      }
    }
    console.log(`  - Processed confessions: ${deletionStats.confessions}, replies: ${deletionStats.confessionReplies}, reactions: ${deletionStats.confessionReactions}`);

    // Chat room members
    const allChatMembers = await ctx.db.query('chatRoomMembers').collect();
    for (const member of allChatMembers) {
      if (isUserToDelete(member.userId)) {
        await ctx.db.delete(member._id);
        deletionStats.chatRoomMembers++;
      }
    }

    // Chat room messages
    const allChatMessages = await ctx.db.query('chatRoomMessages').collect();
    for (const msg of allChatMessages) {
      if (isUserToDelete(msg.senderId)) {
        await ctx.db.delete(msg._id);
        deletionStats.chatRoomMessages++;
      }
    }

    // Chat room penalties
    const allChatPenalties = await ctx.db.query('chatRoomPenalties').collect();
    for (const penalty of allChatPenalties) {
      if (isUserToDelete(penalty.userId)) {
        await ctx.db.delete(penalty._id);
        deletionStats.chatRoomPenalties++;
      }
    }

    // Chat room join requests
    const allChatJoinRequests = await ctx.db.query('chatRoomJoinRequests').collect();
    for (const req of allChatJoinRequests) {
      if (isUserToDelete(req.userId)) {
        await ctx.db.delete(req._id);
        deletionStats.chatRoomJoinRequests++;
      }
    }

    // Chat room bans
    const allChatBans = await ctx.db.query('chatRoomBans').collect();
    for (const ban of allChatBans) {
      if (isUserToDelete(ban.userId)) {
        await ctx.db.delete(ban._id);
        deletionStats.chatRoomBans++;
      }
    }
    console.log(`  - Processed chat rooms: ${deletionStats.chatRoomMembers} memberships, ${deletionStats.chatRoomMessages} messages`);
    console.log(`  - PRESERVED: chatRooms table (public rooms like Global, Hindi, Telugu intact)`);

    // Filter presets
    const allFilterPresets = await ctx.db.query('filterPresets').collect();
    for (const preset of allFilterPresets) {
      if (isUserToDelete(preset.userId)) {
        await ctx.db.delete(preset._id);
        deletionStats.filterPresets++;
      }
    }

    // Chat ToD games (uses string IDs, not Id<'users'>)
    const allChatTodGames = await ctx.db.query('chatTodGames').collect();
    const userIdStrings = new Set(allUsers.map((u) => u._id.toString()));
    for (const game of allChatTodGames) {
      if (userIdStrings.has(game.participant1Id) || userIdStrings.has(game.participant2Id)) {
        await ctx.db.delete(game._id);
        deletionStats.chatTodGames++;
      }
    }

    // Private deletion states
    const allDeletionStates = await ctx.db.query('privateDeletionStates').collect();
    for (const state of allDeletionStates) {
      if (isUserToDelete(state.userId)) {
        await ctx.db.delete(state._id);
        deletionStats.privateDeletionStates++;
      }
    }
    console.log(`  - Processed filter presets: ${deletionStats.filterPresets}, ToD games: ${deletionStats.chatTodGames}, deletion states: ${deletionStats.privateDeletionStates}`);

    // Finally, delete the user records themselves
    for (const user of allUsers) {
      await ctx.db.delete(user._id);
      deletionStats.users++;
    }
    console.log(`  - Deleted ${deletionStats.users} user records`);

    // ============================================================================
    // STEP 3: Summary
    // ============================================================================
    console.log('\n' + '='.repeat(80));
    console.log('DATABASE RESET COMPLETE');
    console.log('='.repeat(80));
    console.log(`Total users deleted: ${allUsers.length}`);
    console.log('\nDeletion statistics by table:');

    const sortedStats = Object.entries(deletionStats)
      .filter(([_, count]) => count > 0)
      .sort(([_, a], [__, b]) => b - a);

    for (const [table, count] of sortedStats) {
      console.log(`  ${table}: ${count}`);
    }

    const totalDeleted = Object.values(deletionStats).reduce((sum, count) => sum + count, 0);
    console.log(`\nTotal documents deleted: ${totalDeleted}`);
    console.log('\nPRESERVED:');
    console.log('  - chatRooms (public rooms intact)');
    console.log('  - system configs');
    console.log('  - global seed data');
    console.log('='.repeat(80));

    // ============================================================================
    // STEP 4: Bump reset epoch to signal clients to clear local caches
    // ============================================================================
    console.log('\n[RESET_EPOCH] Bumping reset epoch to invalidate client caches...');
    const newResetEpoch: number = await ctx.runMutation(internal.system.bumpResetEpoch, {});
    console.log(`[RESET_EPOCH] New reset epoch: ${newResetEpoch}`);
    console.log('[RESET_EPOCH] Clients will detect mismatch and clear local storage on next launch');

    return {
      mode: 'EXECUTE' as const,
      totalUsers: allUsers.length,
      usersDeleted: allUsers.length,
      deletionStats,
      totalDocumentsDeleted: totalDeleted,
      resetEpoch: newResetEpoch,
    };
  },
});

/**
 * Cleanup demo users from the database
 *
 * Deletes ALL demo users and their related data, except for one specified user to keep.
 *
 * Safety features:
 * - Only deletes users with `demoUserId` field set (won't touch real users)
 * - Dry run mode to preview what would be deleted
 * - Idempotent: can be run multiple times safely
 *
 * @param dryRun - If true, only logs what would be deleted without actually deleting
 * @param keepEmail - Email of the demo user to preserve. Pass null to delete ALL demo users.
 *
 * Usage:
 *   DRY RUN (delete all):  npx convex run internal.admin:cleanupDemoUsers '{"dryRun": true, "keepEmail": null}'
 *   EXECUTE (delete all):  npx convex run internal.admin:cleanupDemoUsers '{"dryRun": false, "keepEmail": null}'
 *   Keep one user:         npx convex run internal.admin:cleanupDemoUsers '{"dryRun": false, "keepEmail": "user@example.com"}'
 */
export const cleanupDemoUsers = internalMutation({
  args: {
    dryRun: v.boolean(),
    keepEmail: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const { dryRun, keepEmail } = args;

    console.log('='.repeat(80));
    console.log(`DEMO USER CLEANUP - ${dryRun ? 'DRY RUN' : 'EXECUTE'} MODE`);
    console.log(`Keep user with email: ${keepEmail === null ? 'NONE (delete all demo users)' : keepEmail}`);
    console.log('='.repeat(80));

    // ============================================================================
    // STEP 1: Find all demo users
    // ============================================================================
    const allUsers = await ctx.db.query('users').collect();
    const demoUsers = allUsers.filter((u) => u.demoUserId !== undefined && u.demoUserId !== null);

    console.log(`\n[DISCOVERY] Total users in DB: ${allUsers.length}`);
    console.log(`[DISCOVERY] Demo users found: ${demoUsers.length}`);

    // Find the user to keep (if keepEmail is provided)
    let keepUser = null;
    if (keepEmail !== null) {
      keepUser = demoUsers.find((u) => u.email === keepEmail);
      if (keepUser) {
        console.log(`[DISCOVERY] User to keep found: ${keepUser.name} (${keepUser.email}, demoUserId: ${keepUser.demoUserId})`);
      } else {
        console.log(`[DISCOVERY] WARNING: User with email "${keepEmail}" not found in demo users`);
      }
    } else {
      console.log(`[DISCOVERY] keepEmail=null → Deleting ALL demo users (no exceptions)`);
    }

    // Filter out the user to keep (if any)
    const usersToDelete = keepEmail === null
      ? demoUsers
      : demoUsers.filter((u) => u.email !== keepEmail);
    console.log(`[DISCOVERY] Demo users to delete: ${usersToDelete.length}`);

    if (usersToDelete.length === 0) {
      console.log('\n[RESULT] No demo users to delete. Exiting.');
      return {
        mode: dryRun ? 'DRY_RUN' : 'EXECUTE',
        totalDemoUsers: demoUsers.length,
        usersDeleted: 0,
        keptUser: keepEmail ?? 'none',
        summary: 'No users to delete',
      };
    }

    // Log users that will be deleted
    console.log('\n[USERS TO DELETE]');
    for (const user of usersToDelete) {
      console.log(`  - ${user.name} (${user.email || 'no email'}, demoUserId: ${user.demoUserId})`);
    }

    if (dryRun) {
      console.log('\n[DRY RUN] Skipping actual deletion. Use dryRun=false to execute.');
      return {
        mode: 'DRY_RUN',
        totalDemoUsers: demoUsers.length,
        usersToDelete: usersToDelete.length,
        keptUser: keepEmail,
        userIds: usersToDelete.map((u) => u._id),
      };
    }

    // ============================================================================
    // STEP 2: Delete related data for each demo user
    // Helper function to check if a record belongs to demo users
    // ============================================================================
    const demoUserIds = new Set(usersToDelete.map((u) => u._id));
    const isDemoUserId = (id: Id<'users'>) => demoUserIds.has(id);

    console.log('\n[DELETION] Starting cleanup...');

    const deletionStats = {
      users: 0,
      photos: 0,
      likes: 0,
      matches: 0,
      conversations: 0,
      messages: 0,
      media: 0,
      mediaPermissions: 0,
      notifications: 0,
      crossedPaths: 0,
      crossPathHistory: 0,
      reports: 0,
      blocks: 0,
      sessions: 0,
      typingStatus: 0,
      nudges: 0,
      verificationSessions: 0,
      deviceFingerprints: 0,
      behaviorFlags: 0,
      userStrikes: 0,
      userPrivateProfiles: 0,
      revealRequests: 0,
      confessions: 0,
      confessionReplies: 0,
      confessionReactions: 0,
      confessionReports: 0,
      confessionNotifications: 0,
      chatRoomMembers: 0,
      chatRoomMessages: 0,
      chatRoomPenalties: 0,
      chatRoomJoinRequests: 0,
      chatRoomBans: 0,
      filterPresets: 0,
      crossedEvents: 0,
      chatTodGames: 0,
      privateDeletionStates: 0,
      securityEvents: 0,
      mediaReports: 0,
      surveyResponses: 0,
      moderationQueue: 0,
      purchases: 0,
      subscriptionRecords: 0,
    };

    console.log('[DELETION] Collecting all records to check...');

    // Photos
    const allPhotos = await ctx.db.query('photos').collect();
    for (const photo of allPhotos) {
      if (isDemoUserId(photo.userId)) {
        await ctx.db.delete(photo._id);
        deletionStats.photos++;
      }
    }
    console.log(`  - Processed photos: ${deletionStats.photos} deleted`);

    // Likes (fromUserId or toUserId)
    const allLikes = await ctx.db.query('likes').collect();
    for (const like of allLikes) {
      if (isDemoUserId(like.fromUserId) || isDemoUserId(like.toUserId)) {
        await ctx.db.delete(like._id);
        deletionStats.likes++;
      }
    }
    console.log(`  - Processed likes: ${deletionStats.likes} deleted`);

    // Matches
    const allMatches = await ctx.db.query('matches').collect();
    for (const match of allMatches) {
      if (isDemoUserId(match.user1Id) || isDemoUserId(match.user2Id)) {
        await ctx.db.delete(match._id);
        deletionStats.matches++;
      }
    }
    console.log(`  - Processed matches: ${deletionStats.matches} deleted`);

    // Conversations (check participants array) and their messages
    const allConversations = await ctx.db.query('conversations').collect();
    const conversationsToDelete: Id<'conversations'>[] = [];
    for (const conv of allConversations) {
      const hasDemoUser = conv.participants.some((id) => isDemoUserId(id));
      if (hasDemoUser) {
        conversationsToDelete.push(conv._id);
        await ctx.db.delete(conv._id);
        deletionStats.conversations++;
      }
    }

    // Delete messages in these conversations
    const allMessages = await ctx.db.query('messages').collect();
    for (const msg of allMessages) {
      if (conversationsToDelete.includes(msg.conversationId)) {
        await ctx.db.delete(msg._id);
        deletionStats.messages++;
      }
    }
    console.log(`  - Processed conversations: ${deletionStats.conversations} deleted, ${deletionStats.messages} messages deleted`);

    // Media (check ownerId)
    const allMedia = await ctx.db.query('media').collect();
    for (const media of allMedia) {
      if (isDemoUserId(media.ownerId)) {
        await ctx.db.delete(media._id);
        deletionStats.media++;
      }
    }
    console.log(`  - Processed media: ${deletionStats.media} deleted`);

    // Media permissions (check senderId and recipientId)
    const allMediaPerms = await ctx.db.query('mediaPermissions').collect();
    for (const perm of allMediaPerms) {
      if (isDemoUserId(perm.senderId) || isDemoUserId(perm.recipientId)) {
        await ctx.db.delete(perm._id);
        deletionStats.mediaPermissions++;
      }
    }
    console.log(`  - Processed media permissions: ${deletionStats.mediaPermissions} deleted`);

    // Security events (check actorId)
    const allSecurityEvents = await ctx.db.query('securityEvents').collect();
    for (const event of allSecurityEvents) {
      if (isDemoUserId(event.actorId)) {
        await ctx.db.delete(event._id);
        deletionStats.securityEvents++;
      }
    }

    // Media reports
    const allMediaReports = await ctx.db.query('mediaReports').collect();
    for (const report of allMediaReports) {
      if (isDemoUserId(report.reporterId)) {
        await ctx.db.delete(report._id);
        deletionStats.mediaReports++;
      }
    }
    console.log(`  - Processed security events: ${deletionStats.securityEvents}, media reports: ${deletionStats.mediaReports}`);

    // Notifications
    const allNotifications = await ctx.db.query('notifications').collect();
    for (const notif of allNotifications) {
      if (isDemoUserId(notif.userId)) {
        await ctx.db.delete(notif._id);
        deletionStats.notifications++;
      }
    }
    console.log(`  - Processed notifications: ${deletionStats.notifications} deleted`);

    // Crossed paths
    const allCrossedPaths = await ctx.db.query('crossedPaths').collect();
    for (const cp of allCrossedPaths) {
      if (isDemoUserId(cp.user1Id) || isDemoUserId(cp.user2Id)) {
        await ctx.db.delete(cp._id);
        deletionStats.crossedPaths++;
      }
    }

    // Cross path history (check user1Id and user2Id)
    const allCrossHistory = await ctx.db.query('crossPathHistory').collect();
    for (const ch of allCrossHistory) {
      if (isDemoUserId(ch.user1Id) || isDemoUserId(ch.user2Id)) {
        await ctx.db.delete(ch._id);
        deletionStats.crossPathHistory++;
      }
    }

    // Crossed events
    const allCrossedEvents = await ctx.db.query('crossedEvents').collect();
    for (const event of allCrossedEvents) {
      if (isDemoUserId(event.userId)) {
        await ctx.db.delete(event._id);
        deletionStats.crossedEvents++;
      }
    }
    console.log(`  - Processed crossed paths: ${deletionStats.crossedPaths}, history: ${deletionStats.crossPathHistory}, events: ${deletionStats.crossedEvents}`);

    // Reports
    const allReports = await ctx.db.query('reports').collect();
    for (const report of allReports) {
      if (isDemoUserId(report.reporterId) || isDemoUserId(report.reportedUserId)) {
        await ctx.db.delete(report._id);
        deletionStats.reports++;
      }
    }

    // Blocks
    const allBlocks = await ctx.db.query('blocks').collect();
    for (const block of allBlocks) {
      if (isDemoUserId(block.blockerId) || isDemoUserId(block.blockedUserId)) {
        await ctx.db.delete(block._id);
        deletionStats.blocks++;
      }
    }
    console.log(`  - Processed reports: ${deletionStats.reports}, blocks: ${deletionStats.blocks}`);

    // Sessions
    const allSessions = await ctx.db.query('sessions').collect();
    for (const session of allSessions) {
      if (isDemoUserId(session.userId)) {
        await ctx.db.delete(session._id);
        deletionStats.sessions++;
      }
    }
    console.log(`  - Processed sessions: ${deletionStats.sessions}`);

    // Typing status
    const allTyping = await ctx.db.query('typingStatus').collect();
    for (const t of allTyping) {
      if (isDemoUserId(t.userId)) {
        await ctx.db.delete(t._id);
        deletionStats.typingStatus++;
      }
    }

    // Nudges (just userId, not senderId/receiverId)
    const allNudges = await ctx.db.query('nudges').collect();
    for (const nudge of allNudges) {
      if (isDemoUserId(nudge.userId)) {
        await ctx.db.delete(nudge._id);
        deletionStats.nudges++;
      }
    }

    // Survey responses
    const allSurveyResponses = await ctx.db.query('surveyResponses').collect();
    for (const response of allSurveyResponses) {
      if (response.userId && isDemoUserId(response.userId)) {
        await ctx.db.delete(response._id);
        deletionStats.surveyResponses++;
      }
    }
    console.log(`  - Processed typing: ${deletionStats.typingStatus}, nudges: ${deletionStats.nudges}, surveys: ${deletionStats.surveyResponses}`);

    // Verification sessions
    const allVerificationSessions = await ctx.db.query('verificationSessions').collect();
    for (const vs of allVerificationSessions) {
      if (isDemoUserId(vs.userId)) {
        await ctx.db.delete(vs._id);
        deletionStats.verificationSessions++;
      }
    }

    // Device fingerprints
    const allFingerprints = await ctx.db.query('deviceFingerprints').collect();
    for (const fp of allFingerprints) {
      if (fp.userId && isDemoUserId(fp.userId)) {
        await ctx.db.delete(fp._id);
        deletionStats.deviceFingerprints++;
      }
    }

    // Behavior flags
    const allBehaviorFlags = await ctx.db.query('behaviorFlags').collect();
    for (const bf of allBehaviorFlags) {
      if (isDemoUserId(bf.userId)) {
        await ctx.db.delete(bf._id);
        deletionStats.behaviorFlags++;
      }
    }

    // Moderation queue (check reporterId if exists)
    const allModerationQueue = await ctx.db.query('moderationQueue').collect();
    for (const mq of allModerationQueue) {
      if (mq.reporterId && isDemoUserId(mq.reporterId)) {
        await ctx.db.delete(mq._id);
        deletionStats.moderationQueue++;
      }
    }

    // User strikes
    const allStrikes = await ctx.db.query('userStrikes').collect();
    for (const strike of allStrikes) {
      if (isDemoUserId(strike.userId)) {
        await ctx.db.delete(strike._id);
        deletionStats.userStrikes++;
      }
    }
    console.log(`  - Processed verification: ${deletionStats.verificationSessions}, fingerprints: ${deletionStats.deviceFingerprints}, strikes: ${deletionStats.userStrikes}`);

    // Subscription records
    const allSubscriptionRecords = await ctx.db.query('subscriptionRecords').collect();
    for (const sub of allSubscriptionRecords) {
      if (isDemoUserId(sub.userId)) {
        await ctx.db.delete(sub._id);
        deletionStats.subscriptionRecords++;
      }
    }

    // Purchases
    const allPurchases = await ctx.db.query('purchases').collect();
    for (const purchase of allPurchases) {
      if (isDemoUserId(purchase.userId)) {
        await ctx.db.delete(purchase._id);
        deletionStats.purchases++;
      }
    }
    console.log(`  - Processed subscriptions: ${deletionStats.subscriptionRecords}, purchases: ${deletionStats.purchases}`);

    // User private profiles
    const allPrivateProfiles = await ctx.db.query('userPrivateProfiles').collect();
    for (const pp of allPrivateProfiles) {
      if (isDemoUserId(pp.userId)) {
        await ctx.db.delete(pp._id);
        deletionStats.userPrivateProfiles++;
      }
    }

    // Reveal requests
    const allRevealRequests = await ctx.db.query('revealRequests').collect();
    for (const reveal of allRevealRequests) {
      if (isDemoUserId(reveal.fromUserId) || isDemoUserId(reveal.toUserId)) {
        await ctx.db.delete(reveal._id);
        deletionStats.revealRequests++;
      }
    }
    console.log(`  - Processed private profiles: ${deletionStats.userPrivateProfiles}, reveal requests: ${deletionStats.revealRequests}`);

    // Confessions (check userId if exists)
    const allConfessions = await ctx.db.query('confessions').collect();
    for (const confession of allConfessions) {
      if (confession.userId && isDemoUserId(confession.userId)) {
        await ctx.db.delete(confession._id);
        deletionStats.confessions++;
      }
    }

    // Confession replies
    const allConfessionReplies = await ctx.db.query('confessionReplies').collect();
    for (const reply of allConfessionReplies) {
      if (reply.userId && isDemoUserId(reply.userId)) {
        await ctx.db.delete(reply._id);
        deletionStats.confessionReplies++;
      }
    }

    // Confession reactions
    const allConfessionReactions = await ctx.db.query('confessionReactions').collect();
    for (const reaction of allConfessionReactions) {
      if (isDemoUserId(reaction.userId)) {
        await ctx.db.delete(reaction._id);
        deletionStats.confessionReactions++;
      }
    }

    // Confession reports
    const allConfessionReports = await ctx.db.query('confessionReports').collect();
    for (const report of allConfessionReports) {
      if (isDemoUserId(report.reporterId)) {
        await ctx.db.delete(report._id);
        deletionStats.confessionReports++;
      }
    }

    // Confession notifications
    const allConfessionNotifs = await ctx.db.query('confessionNotifications').collect();
    for (const notif of allConfessionNotifs) {
      if (isDemoUserId(notif.userId)) {
        await ctx.db.delete(notif._id);
        deletionStats.confessionNotifications++;
      }
    }
    console.log(`  - Processed confessions: ${deletionStats.confessions}, replies: ${deletionStats.confessionReplies}, reactions: ${deletionStats.confessionReactions}`);

    // Chat room members
    const allChatMembers = await ctx.db.query('chatRoomMembers').collect();
    for (const member of allChatMembers) {
      if (isDemoUserId(member.userId)) {
        await ctx.db.delete(member._id);
        deletionStats.chatRoomMembers++;
      }
    }

    // Chat room messages
    const allChatMessages = await ctx.db.query('chatRoomMessages').collect();
    for (const msg of allChatMessages) {
      if (isDemoUserId(msg.senderId)) {
        await ctx.db.delete(msg._id);
        deletionStats.chatRoomMessages++;
      }
    }

    // Chat room penalties
    const allChatPenalties = await ctx.db.query('chatRoomPenalties').collect();
    for (const penalty of allChatPenalties) {
      if (isDemoUserId(penalty.userId)) {
        await ctx.db.delete(penalty._id);
        deletionStats.chatRoomPenalties++;
      }
    }

    // Chat room join requests
    const allChatJoinRequests = await ctx.db.query('chatRoomJoinRequests').collect();
    for (const req of allChatJoinRequests) {
      if (isDemoUserId(req.userId)) {
        await ctx.db.delete(req._id);
        deletionStats.chatRoomJoinRequests++;
      }
    }

    // Chat room bans
    const allChatBans = await ctx.db.query('chatRoomBans').collect();
    for (const ban of allChatBans) {
      if (isDemoUserId(ban.userId)) {
        await ctx.db.delete(ban._id);
        deletionStats.chatRoomBans++;
      }
    }
    console.log(`  - Processed chat rooms: ${deletionStats.chatRoomMembers} memberships, ${deletionStats.chatRoomMessages} messages`);

    // Filter presets
    const allFilterPresets = await ctx.db.query('filterPresets').collect();
    for (const preset of allFilterPresets) {
      if (isDemoUserId(preset.userId)) {
        await ctx.db.delete(preset._id);
        deletionStats.filterPresets++;
      }
    }

    // Chat ToD games (uses string IDs, not Id<'users'>)
    const allChatTodGames = await ctx.db.query('chatTodGames').collect();
    const demoUserIdStrings = new Set(usersToDelete.map((u) => u._id.toString()));
    for (const game of allChatTodGames) {
      if (demoUserIdStrings.has(game.participant1Id) || demoUserIdStrings.has(game.participant2Id)) {
        await ctx.db.delete(game._id);
        deletionStats.chatTodGames++;
      }
    }

    // Private deletion states
    const allDeletionStates = await ctx.db.query('privateDeletionStates').collect();
    for (const state of allDeletionStates) {
      if (isDemoUserId(state.userId)) {
        await ctx.db.delete(state._id);
        deletionStats.privateDeletionStates++;
      }
    }
    console.log(`  - Processed filter presets: ${deletionStats.filterPresets}, ToD games: ${deletionStats.chatTodGames}, deletion states: ${deletionStats.privateDeletionStates}`);

    // Finally, delete the user records themselves
    for (const user of usersToDelete) {
      await ctx.db.delete(user._id);
      deletionStats.users++;
    }
    console.log(`  - Deleted ${deletionStats.users} user records`);

    // ============================================================================
    // STEP 3: Summary
    // ============================================================================
    console.log('\n' + '='.repeat(80));
    console.log('CLEANUP COMPLETE');
    console.log('='.repeat(80));
    console.log(`Total demo users found: ${demoUsers.length}`);
    console.log(`Demo users deleted: ${usersToDelete.length}`);
    console.log(`User kept: ${keepEmail === null ? 'NONE (all deleted)' : keepEmail}`);
    console.log('\nDeletion statistics by table:');

    const sortedStats = Object.entries(deletionStats)
      .filter(([_, count]) => count > 0)
      .sort(([_, a], [__, b]) => b - a);

    for (const [table, count] of sortedStats) {
      console.log(`  ${table}: ${count}`);
    }

    const totalDeleted = Object.values(deletionStats).reduce((sum, count) => sum + count, 0);
    console.log(`\nTotal documents deleted: ${totalDeleted}`);
    console.log('='.repeat(80));

    return {
      mode: 'EXECUTE',
      totalDemoUsers: demoUsers.length,
      usersDeleted: usersToDelete.length,
      keptUser: keepEmail ?? 'none',
      deletionStats,
      totalDocumentsDeleted: totalDeleted,
    };
  },
});

/**
 * Backfill primaryPhotoUrl for existing users
 *
 * STABILITY FIX: C-10 - Populates the denormalized primaryPhotoUrl field
 * for users who don't have it set yet.
 *
 * Safety features:
 * - Processes max 50 users per run to avoid timeouts
 * - Skips users that already have primaryPhotoUrl set
 * - Idempotent: can be run multiple times safely
 *
 * Usage:
 *   npx convex run admin:backfillPrimaryPhotoUrl
 *
 * Run multiple times until processedCount returns 0.
 */
export const backfillPrimaryPhotoUrl = internalMutation({
  args: {},
  handler: async (ctx) => {
    const BATCH_LIMIT = 50;

    console.log('='.repeat(80));
    console.log('BACKFILL: primaryPhotoUrl');
    console.log(`Processing up to ${BATCH_LIMIT} users per run`);
    console.log('='.repeat(80));

    // Query all users, filter to those missing primaryPhotoUrl
    const allUsers = await ctx.db.query('users').collect();
    const usersToBackfill = allUsers.filter((u) => !u.primaryPhotoUrl);

    console.log(`[DISCOVERY] Total users: ${allUsers.length}`);
    console.log(`[DISCOVERY] Users missing primaryPhotoUrl: ${usersToBackfill.length}`);

    if (usersToBackfill.length === 0) {
      console.log('\n[RESULT] All users already have primaryPhotoUrl. Backfill complete.');
      return {
        totalUsers: allUsers.length,
        processedCount: 0,
        remainingCount: 0,
        status: 'complete',
      };
    }

    // Process up to BATCH_LIMIT users
    const batch = usersToBackfill.slice(0, BATCH_LIMIT);
    let updatedCount = 0;
    let skippedCount = 0;

    console.log(`\n[PROCESSING] Backfilling ${batch.length} users...`);

    for (const user of batch) {
      // Find primary photo for this user
      const primaryPhoto = await ctx.db
        .query('photos')
        .withIndex('by_user', (q) => q.eq('userId', user._id))
        .filter((q) => q.eq(q.field('isPrimary'), true))
        .first();

      if (primaryPhoto) {
        await ctx.db.patch(user._id, { primaryPhotoUrl: primaryPhoto.url });
        updatedCount++;
        if (updatedCount <= 5) {
          console.log(`  - Updated: ${user.name} (${user._id})`);
        }
      } else {
        // No primary photo found, skip
        skippedCount++;
      }
    }

    if (updatedCount > 5) {
      console.log(`  ... and ${updatedCount - 5} more`);
    }

    const remainingCount = usersToBackfill.length - batch.length;

    console.log('\n' + '='.repeat(80));
    console.log('BACKFILL BATCH COMPLETE');
    console.log('='.repeat(80));
    console.log(`Updated: ${updatedCount}`);
    console.log(`Skipped (no primary photo): ${skippedCount}`);
    console.log(`Remaining: ${remainingCount}`);

    if (remainingCount > 0) {
      console.log('\nRun this mutation again to process remaining users.');
    } else {
      console.log('\nAll users processed. Backfill complete.');
    }

    return {
      totalUsers: allUsers.length,
      processedCount: batch.length,
      updatedCount,
      skippedCount,
      remainingCount,
      status: remainingCount > 0 ? 'in_progress' : 'complete',
    };
  },
});

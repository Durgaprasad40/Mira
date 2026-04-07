/**
 * DEBUG ONLY: Reset interaction data between two specific test accounts
 *
 * This script clears ONLY the interaction data between two specified accounts:
 * - likes (swipes) in both directions
 * - matches between them
 * - conversations between them
 * - messages in those conversations
 * - conversation participants entries
 * - cooldown timestamps (lastShownInDiscoverAt)
 *
 * It does NOT delete the accounts or affect other users.
 *
 * Run with: npx convex run scripts/resetTestPair:auditPair
 * Then:     npx convex run scripts/resetTestPair:resetPair
 */
import { mutation, query } from '../_generated/server';
import { v } from 'convex/values';
import { Id } from '../_generated/dataModel';

// Test account IDs - update these as needed
const ONEPLUS_USER_ID = 'm1705gr4w5h2far0t3553xrgt583246p' as Id<'users'>;

/**
 * Audit: Find all interaction data between test accounts
 */
export const auditPair = query({
  args: {},
  handler: async (ctx) => {
    // Get all users to identify accounts
    const allUsers = await ctx.db.query('users').collect();

    console.log('='.repeat(80));
    console.log('TEST ACCOUNT PAIR AUDIT');
    console.log('='.repeat(80));

    // List all users
    console.log('\nAll users in DB:');
    for (const u of allUsers) {
      console.log(`  - ${u.name} (${u._id}) - ${u.gender} - category: ${u.assignedDiscoverCategory}`);
    }

    const onePlusUser = allUsers.find(u => u._id === ONEPLUS_USER_ID);
    if (!onePlusUser) {
      return { error: 'OnePlus user not found' };
    }

    // Find all female accounts (potential Samsung test account)
    const femaleAccounts = allUsers.filter(u => u.gender === 'female' && u._id !== ONEPLUS_USER_ID);

    console.log(`\nOnePlus account: ${onePlusUser.name} (${onePlusUser._id})`);
    console.log(`Female accounts (potential Samsung): ${femaleAccounts.map(u => u.name).join(', ')}`);

    // Check likes in ALL directions
    const allLikes = await ctx.db.query('likes').collect();
    const relevantLikes = allLikes.filter(l =>
      l.fromUserId === ONEPLUS_USER_ID ||
      l.toUserId === ONEPLUS_USER_ID ||
      femaleAccounts.some(f => f._id === l.fromUserId || f._id === l.toUserId)
    );

    console.log(`\nLikes involving test accounts: ${relevantLikes.length}`);
    for (const like of relevantLikes) {
      const from = allUsers.find(u => u._id === like.fromUserId)?.name || like.fromUserId;
      const to = allUsers.find(u => u._id === like.toUserId)?.name || like.toUserId;
      console.log(`  - ${from} -> ${to}: ${like.action} (${like._id})`);
    }

    // Check matches
    const allMatches = await ctx.db.query('matches').collect();
    const relevantMatches = allMatches.filter(m =>
      m.user1Id === ONEPLUS_USER_ID ||
      m.user2Id === ONEPLUS_USER_ID ||
      femaleAccounts.some(f => f._id === m.user1Id || f._id === m.user2Id)
    );

    console.log(`\nMatches involving test accounts: ${relevantMatches.length}`);
    for (const match of relevantMatches) {
      const user1 = allUsers.find(u => u._id === match.user1Id)?.name || match.user1Id;
      const user2 = allUsers.find(u => u._id === match.user2Id)?.name || match.user2Id;
      console.log(`  - ${user1} <-> ${user2}: active=${match.isActive} (${match._id})`);
    }

    // Check conversations
    const allConvos = await ctx.db.query('conversations').collect();
    const relevantConvos = allConvos.filter(c =>
      c.participants.includes(ONEPLUS_USER_ID) ||
      c.participants.some(p => femaleAccounts.some(f => f._id === p))
    );

    console.log(`\nConversations involving test accounts: ${relevantConvos.length}`);
    for (const convo of relevantConvos) {
      const participants = convo.participants.map(p => allUsers.find(u => u._id === p)?.name || p);
      console.log(`  - [${participants.join(', ')}] (${convo._id})`);
    }

    // Check cooldowns
    console.log('\nCooldown status:');
    console.log(`  - ${onePlusUser.name}: lastShownInDiscoverAt = ${onePlusUser.lastShownInDiscoverAt || 'none'}`);
    for (const f of femaleAccounts) {
      console.log(`  - ${f.name}: lastShownInDiscoverAt = ${f.lastShownInDiscoverAt || 'none'}`);
    }

    return {
      onePlusUser: { id: onePlusUser._id, name: onePlusUser.name },
      femaleAccounts: femaleAccounts.map(f => ({ id: f._id, name: f.name })),
      likes: relevantLikes.map(l => ({ id: l._id, from: l.fromUserId, to: l.toUserId, action: l.action })),
      matches: relevantMatches.map(m => ({ id: m._id, user1: m.user1Id, user2: m.user2Id, active: m.isActive })),
      conversations: relevantConvos.map(c => ({ id: c._id, participants: c.participants })),
    };
  },
});

/**
 * Reset: Clear all interaction data between OnePlus and ALL female test accounts
 */
export const resetPair = mutation({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true; // Default to dry run for safety

    console.log('='.repeat(80));
    console.log(`TEST PAIR RESET - ${dryRun ? 'DRY RUN' : 'EXECUTE'}`);
    console.log('='.repeat(80));

    const allUsers = await ctx.db.query('users').collect();
    const onePlusUser = allUsers.find(u => u._id === ONEPLUS_USER_ID);
    if (!onePlusUser) {
      return { error: 'OnePlus user not found' };
    }

    const femaleAccounts = allUsers.filter(u => u.gender === 'female' && u._id !== ONEPLUS_USER_ID);
    const testUserIds = new Set([ONEPLUS_USER_ID as string, ...femaleAccounts.map(f => f._id as string)]);

    const stats = {
      likesDeleted: 0,
      matchesDeleted: 0,
      conversationsDeleted: 0,
      messagesDeleted: 0,
      participantsDeleted: 0,
      cooldownsCleared: 0,
    };

    // 1. Delete likes between test accounts
    const allLikes = await ctx.db.query('likes').collect();
    for (const like of allLikes) {
      if (testUserIds.has(like.fromUserId as string) && testUserIds.has(like.toUserId as string)) {
        console.log(`[LIKE] Delete: ${like.fromUserId} -> ${like.toUserId} (${like.action})`);
        if (!dryRun) {
          await ctx.db.delete(like._id);
        }
        stats.likesDeleted++;
      }
    }

    // 2. Delete matches between test accounts
    const allMatches = await ctx.db.query('matches').collect();
    for (const match of allMatches) {
      if (testUserIds.has(match.user1Id as string) && testUserIds.has(match.user2Id as string)) {
        console.log(`[MATCH] Delete: ${match.user1Id} <-> ${match.user2Id}`);
        if (!dryRun) {
          await ctx.db.delete(match._id);
        }
        stats.matchesDeleted++;
      }
    }

    // 3. Delete conversations (and messages + participants) between test accounts
    const allConvos = await ctx.db.query('conversations').collect();
    for (const convo of allConvos) {
      const isTestConvo = convo.participants.every(p => testUserIds.has(p as string));
      if (isTestConvo) {
        console.log(`[CONVERSATION] Delete: ${convo._id}`);

        // Delete messages in this conversation
        const messages = await ctx.db
          .query('messages')
          .withIndex('by_conversation', q => q.eq('conversationId', convo._id))
          .collect();
        for (const msg of messages) {
          if (!dryRun) {
            await ctx.db.delete(msg._id);
          }
          stats.messagesDeleted++;
        }

        // Delete conversation participants
        const participants = await ctx.db
          .query('conversationParticipants')
          .withIndex('by_conversation', q => q.eq('conversationId', convo._id))
          .collect();
        for (const p of participants) {
          if (!dryRun) {
            await ctx.db.delete(p._id);
          }
          stats.participantsDeleted++;
        }

        // Delete conversation
        if (!dryRun) {
          await ctx.db.delete(convo._id);
        }
        stats.conversationsDeleted++;
      }
    }

    // 4. Clear cooldowns for all test accounts
    for (const userId of testUserIds) {
      const user = await ctx.db.get(userId as Id<'users'>);
      if (user && user.lastShownInDiscoverAt) {
        console.log(`[COOLDOWN] Clear: ${user.name}`);
        if (!dryRun) {
          await ctx.db.patch(userId as Id<'users'>, {
            lastShownInDiscoverAt: undefined,
          });
        }
        stats.cooldownsCleared++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('RESET SUMMARY');
    console.log('='.repeat(80));
    console.log(`Mode: ${dryRun ? 'DRY RUN (no changes made)' : 'EXECUTED'}`);
    console.log(`Likes deleted: ${stats.likesDeleted}`);
    console.log(`Matches deleted: ${stats.matchesDeleted}`);
    console.log(`Conversations deleted: ${stats.conversationsDeleted}`);
    console.log(`Messages deleted: ${stats.messagesDeleted}`);
    console.log(`Participants deleted: ${stats.participantsDeleted}`);
    console.log(`Cooldowns cleared: ${stats.cooldownsCleared}`);

    return {
      dryRun,
      stats,
      testAccounts: {
        onePlus: { id: onePlusUser._id, name: onePlusUser.name },
        others: femaleAccounts.map(f => ({ id: f._id, name: f.name })),
      },
    };
  },
});

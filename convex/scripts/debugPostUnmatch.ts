/**
 * DEBUG ONLY: Audit post-unmatch eligibility between two specific users
 */
import { query } from '../_generated/server';
import { Id } from '../_generated/dataModel';

// The unmatched test pair
const PUKA_KOJJA_ID = 'm170wje32shsfrc1k5tjsh5hd18344vp' as Id<'users'>;
const HAHAHA_JPG_ID = 'm179mzxzvfmhfcf640r9mxcr81835w90' as Id<'users'>;

export const auditPostUnmatch = query({
  args: {},
  handler: async (ctx) => {
    const passExpiry = Date.now() - 7 * 24 * 60 * 60 * 1000;

    console.log('='.repeat(80));
    console.log('POST-UNMATCH ELIGIBILITY AUDIT');
    console.log('='.repeat(80));

    // Get both users
    const pukaKojja = await ctx.db.get(PUKA_KOJJA_ID);
    const hahahaJpg = await ctx.db.get(HAHAHA_JPG_ID);

    if (!pukaKojja || !hahahaJpg) {
      return { error: 'Users not found' };
    }

    console.log(`\nUser 1: ${pukaKojja.name} (${pukaKojja._id})`);
    console.log(`User 2: ${hahahaJpg.name} (${hahahaJpg._id})`);

    // Check likes in both directions
    const likesFromPuka = await ctx.db
      .query('likes')
      .withIndex('by_from_to', (q) => q.eq('fromUserId', PUKA_KOJJA_ID).eq('toUserId', HAHAHA_JPG_ID))
      .collect();

    const likesFromHahaha = await ctx.db
      .query('likes')
      .withIndex('by_from_to', (q) => q.eq('fromUserId', HAHAHA_JPG_ID).eq('toUserId', PUKA_KOJJA_ID))
      .collect();

    console.log('\n--- LIKES ---');
    console.log(`Puka Kojja -> Hahaha Jpg: ${likesFromPuka.length} records`);
    for (const like of likesFromPuka) {
      const isExpiredPass = like.action === 'pass' && like.createdAt < passExpiry;
      console.log(`  - ${like.action} at ${new Date(like.createdAt).toISOString()} (ID: ${like._id})${isExpiredPass ? ' [EXPIRED PASS - would not block]' : ' [BLOCKS]'}`);
    }
    console.log(`Hahaha Jpg -> Puka Kojja: ${likesFromHahaha.length} records`);
    for (const like of likesFromHahaha) {
      const isExpiredPass = like.action === 'pass' && like.createdAt < passExpiry;
      console.log(`  - ${like.action} at ${new Date(like.createdAt).toISOString()} (ID: ${like._id})${isExpiredPass ? ' [EXPIRED PASS - would not block]' : ' [BLOCKS]'}`);
    }

    // Check matches
    const matchesBetween = await ctx.db
      .query('matches')
      .withIndex('by_users', (q) => q.eq('user1Id', PUKA_KOJJA_ID).eq('user2Id', HAHAHA_JPG_ID))
      .collect();

    const matchesBetweenReverse = await ctx.db
      .query('matches')
      .withIndex('by_users', (q) => q.eq('user1Id', HAHAHA_JPG_ID).eq('user2Id', PUKA_KOJJA_ID))
      .collect();

    const allMatches = [...matchesBetween, ...matchesBetweenReverse];

    console.log('\n--- MATCHES ---');
    console.log(`Total matches between pair: ${allMatches.length}`);
    for (const match of allMatches) {
      console.log(`  - isActive: ${match.isActive} (ID: ${match._id})${match.isActive ? ' [WOULD BLOCK if isActive filter was missing]' : ' [DOES NOT BLOCK - isActive=false]'}`);
    }

    // Check conversations
    const pukaParticipations = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', PUKA_KOJJA_ID))
      .collect();

    const hahahaParticipations = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_user', (q) => q.eq('userId', HAHAHA_JPG_ID))
      .collect();

    // Find shared conversations
    const pukaConvoIds = new Set(pukaParticipations.map(p => p.conversationId as string));
    const sharedConvoIds = hahahaParticipations
      .filter(p => pukaConvoIds.has(p.conversationId as string))
      .map(p => p.conversationId);

    console.log('\n--- CONVERSATIONS ---');
    console.log(`Shared conversations: ${sharedConvoIds.length}`);
    for (const convoId of sharedConvoIds) {
      const convo = await ctx.db.get(convoId);
      console.log(`  - Conversation ${convoId}: matchId=${convo?.matchId}, isPreMatch=${convo?.isPreMatch} [BLOCKS via conversationPartnerIds]`);
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('BLOCKING ANALYSIS');
    console.log('='.repeat(80));

    const blockingLikesFromPuka = likesFromPuka.filter(l => !(l.action === 'pass' && l.createdAt < passExpiry));
    const blockingLikesFromHahaha = likesFromHahaha.filter(l => !(l.action === 'pass' && l.createdAt < passExpiry));
    const activeMatches = allMatches.filter(m => m.isActive);

    console.log('\nFrom Puka Kojja perspective (can Hahaha Jpg appear?):');
    console.log(`  - Blocked by likes (swipedUserIds)? ${blockingLikesFromPuka.length > 0 ? 'YES - ' + blockingLikesFromPuka.length + ' blocking likes' : 'NO'}`);
    console.log(`  - Blocked by matches (matchedUserIds)? ${activeMatches.length > 0 ? 'YES' : 'NO - all matches have isActive=false'}`);
    console.log(`  - Blocked by conversations (conversationPartnerIds)? ${sharedConvoIds.length > 0 ? 'YES - ' + sharedConvoIds.length + ' shared conversations' : 'NO'}`);

    console.log('\nFrom Hahaha Jpg perspective (can Puka Kojja appear?):');
    console.log(`  - Blocked by likes (swipedUserIds)? ${blockingLikesFromHahaha.length > 0 ? 'YES - ' + blockingLikesFromHahaha.length + ' blocking likes' : 'NO'}`);
    console.log(`  - Blocked by matches (matchedUserIds)? ${activeMatches.length > 0 ? 'YES' : 'NO - all matches have isActive=false'}`);
    console.log(`  - Blocked by conversations (conversationPartnerIds)? ${sharedConvoIds.length > 0 ? 'YES - ' + sharedConvoIds.length + ' shared conversations' : 'NO'}`);

    // Final verdict
    const pukaCanSeeHahaha = blockingLikesFromPuka.length === 0 && activeMatches.length === 0 && sharedConvoIds.length === 0;
    const hahahaCanSeePuka = blockingLikesFromHahaha.length === 0 && activeMatches.length === 0 && sharedConvoIds.length === 0;

    console.log('\n' + '='.repeat(80));
    console.log('VERDICT');
    console.log('='.repeat(80));
    console.log(`Can Puka Kojja see Hahaha Jpg in Explore/Discover? ${pukaCanSeeHahaha ? '✅ YES' : '❌ NO'}`);
    console.log(`Can Hahaha Jpg see Puka Kojja in Explore/Discover? ${hahahaCanSeePuka ? '✅ YES' : '❌ NO'}`);

    if (!pukaCanSeeHahaha || !hahahaCanSeePuka) {
      console.log('\nREQUIRED FIX:');
      if (blockingLikesFromPuka.length > 0 || blockingLikesFromHahaha.length > 0) {
        console.log('  1. Delete like records between the pair');
      }
      if (sharedConvoIds.length > 0) {
        console.log('  2. Delete conversation(s) between the pair (including messages + participants)');
      }
    }

    return {
      user1: { id: pukaKojja._id, name: pukaKojja.name },
      user2: { id: hahahaJpg._id, name: hahahaJpg.name },
      likes: {
        fromPuka: likesFromPuka.map(l => ({ id: l._id, action: l.action, createdAt: l.createdAt })),
        fromHahaha: likesFromHahaha.map(l => ({ id: l._id, action: l.action, createdAt: l.createdAt })),
      },
      matches: allMatches.map(m => ({ id: m._id, isActive: m.isActive })),
      conversations: sharedConvoIds,
      blocking: {
        likesFromPuka: blockingLikesFromPuka.length,
        likesFromHahaha: blockingLikesFromHahaha.length,
        activeMatches: activeMatches.length,
        sharedConversations: sharedConvoIds.length,
      },
      canReappear: {
        pukaCanSeeHahaha,
        hahahaCanSeePuka,
      },
    };
  },
});

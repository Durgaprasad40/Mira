import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// 4-2: Cleanup expired notifications every hour
crons.hourly(
  'cleanup-expired-notifications',
  { minuteUTC: 30 }, // Run at :30 past each hour
  internal.notifications.cleanupExpiredNotifications
);

// Phase-1 Messages: cleanup stale typing rows so abrupt closes/crashes do not leave
// typing state records hanging around indefinitely.
crons.interval(
  'cleanup-stale-typing-status',
  { minutes: 5 },
  internal.messages.cleanupStaleTypingStatus
);

// Chat Rooms one-on-one DMs are temporary. Expire/delete room-originated
// private threads after 3 hours with no messages from either participant.
crons.interval(
  'cleanup-expired-chat-room-private-dms',
  { minutes: 10 },
  internal.messages.cleanupExpiredChatRoomPrivateDms
);

// Phase-1 secure media: enforce backend expiry by revoking expired access and
// retrying storage deletion for already-expired media.
crons.interval(
  'cleanup-expired-protected-media',
  { minutes: 1 },
  internal.protectedMedia.cleanupExpiredMedia
);

// Phase-2 Messages secure media: backend enforcement of expiry for
// `privateMessages` rows. Mirrors the Phase-1 cron above but operates
// strictly on Phase-2 tables (privateMessages) and Phase-2 storage blobs —
// Phase-1 tables (media/mediaPermissions) are NEVER touched here. Sweeps any
// protected privateMessage whose `timerEndsAt` has elapsed (or whose
// `isExpired` was already flipped by the client), deletes its storage blob,
// and clears `imageStorageId` so subsequent `getPrivateMessages` queries
// can never re-issue a playable URL.
crons.interval(
  'cleanup-expired-private-protected-media',
  { minutes: 1 },
  internal.privateConversations.cleanupExpiredPrivateProtectedMedia
);

// 8C: Cleanup verification photos older than 90 days (daily at 3:00 AM UTC)
crons.daily(
  'cleanup-verification-photos',
  { hourUTC: 3, minuteUTC: 0 },
  internal.verification.cleanupOldVerificationPhotos
);

// ToD: Cleanup very old Truth/Dare data after the retention window.
// Prompt expiry itself is read-only history, not a deletion trigger.
crons.interval(
  'cleanup-expired-tod-data',
  { minutes: 15 },
  internal.truthDare.cleanupExpiredTodData
);

// Confess Connect: mark stale pending connect requests as expired. Rows are
// retained for audit/idempotency; only pending rows are patched.
crons.hourly(
  'cleanup-expired-confession-connects',
  { minuteUTC: 40 },
  internal.confessions.cleanupExpiredConfessionConnects,
  {}
);

// Phase-2 Chat Rooms: Cleanup expired messages every 5 minutes
// Deletes messages past their 24h expiresAt (plus bounded legacy sweep for
// pre-retention rows) and re-syncs per-room messageCount from source of truth.
crons.interval(
  'cleanup-expired-chat-room-messages',
  { minutes: 5 },
  internal.chatRooms.cleanupExpiredChatRoomMessages
);

// Phase-2 Chat Rooms: Cleanup expired rooms every 10 minutes (safety net for scheduler)
// Deletes rooms past their 24h expiresAt, along with all messages/members/penalties
crons.interval(
  'cleanup-expired-chat-rooms',
  { minutes: 10 },
  internal.chatRooms.cleanupExpiredRooms
);

// Phase-2 Chat Rooms: Cleanup expired penalties every hour
// Removes penalty records past their 24h expiration
crons.hourly(
  'cleanup-expired-chat-room-penalties',
  { minuteUTC: 45 },
  internal.chatRooms.cleanupExpiredPenalties
);

// P2-14: Phase-2 Chat Rooms — Cleanup stale presence rows every 10 minutes.
// Deletes chatRoomPresence rows whose last heartbeat is older than 1 hour
// so abandoned sessions don't accumulate indefinitely.
crons.interval(
  'cleanup-stale-chat-room-presence',
  { minutes: 10 },
  internal.chatRooms.cleanupStalePresence
);

// P2-15: Phase-2 Chat Rooms — Cleanup orphan media ownership rows daily.
// Any chatRoomMediaUploads row older than retention + grace is an orphan
// because its referring message would have been cleaned up under the 24h
// retention policy.
crons.daily(
  'cleanup-orphan-chat-room-media-uploads',
  { hourUTC: 3, minuteUTC: 20 },
  internal.chatRooms.cleanupOrphanChatRoomMediaUploads
);

// P2-25: Phase-2 Chat Rooms — Safety-net orphan sweep for reactions and
// mention notifications (low frequency; the primary cascade runs inline
// on message delete).
crons.daily(
  'cleanup-orphan-chat-room-reactions-mentions',
  { hourUTC: 3, minuteUTC: 35 },
  internal.chatRooms.cleanupOrphanReactionsAndMentions
);

// P2-16: Phase-2 Chat Rooms — TTL sweep for join requests.
// Resolved (approved/rejected) rows age out after 30 days; still-pending
// rows age out after 90 days.
crons.daily(
  'cleanup-stale-chat-room-join-requests',
  { hourUTC: 3, minuteUTC: 50 },
  internal.chatRooms.cleanupStaleJoinRequests
);

// P2-17: Phase-2 Chat Rooms — TTL sweep for password-attempt rows.
// Rows whose lastAttemptAt is older than 7 days are removed (including
// blocked rows) so the table does not accumulate forever.
crons.daily(
  'cleanup-stale-chat-room-password-attempts',
  { hourUTC: 4, minuteUTC: 5 },
  internal.chatRooms.cleanupStalePasswordAttempts
);

// B2-FIX: Retry failed storage deletions every 30 minutes
// Cleans up orphaned storage blobs from failed photo deletions
crons.interval(
  'retry-failed-storage-deletions',
  { minutes: 30 },
  internal.photos.retryFailedStorageDeletions
);

// Phase-1 account deletion: finalize expired soft-deleted accounts after the
// 30-day recovery window so old identities cannot be restored indefinitely.
crons.daily(
  'finalize-expired-soft-deleted-accounts',
  { hourUTC: 2, minuteUTC: 0 },
  internal.auth.finalizeExpiredSoftDeletedAccounts
);

// Nearby/Crossed Paths: Cleanup expired crossed path history every 6 hours
// Removes history entries past their 30-day expiration
crons.interval(
  'cleanup-expired-crossed-path-history',
  { hours: 6 },
  internal.crossedPaths.cleanupExpiredHistory
);

// Nearby/Crossed Paths: Cleanup daily-shown ledger rows after 30 days
// Prevents the crossedPathDailyShown cap ledger from growing forever.
crons.daily(
  'cleanup-expired-crossed-path-daily-shown',
  { hourUTC: 4, minuteUTC: 15 },
  internal.crossedPaths.cleanupExpiredCrossedPathDailyShown
);

// Nearby/Crossed Paths: Cleanup expired crossed events every hour
// Removes crossed events past their 7-day expiration
crons.hourly(
  'cleanup-expired-crossed-events',
  { minuteUTC: 15 },
  internal.crossedPaths.cleanupExpiredCrossedEvents
);

// Phase-1 Background Crossed Paths: Cleanup expired location samples every hour
// Removes rows from the short-lived locationSamples ring-buffer past their
// 6-hour TTL so background writes cannot grow the table unboundedly.
crons.hourly(
  'cleanup-expired-location-samples',
  { minuteUTC: 25 },
  internal.crossedPaths.cleanupExpiredLocationSamples
);

// Phase 1 Background Crossed Paths: TTL sweep for the bgLocationAuditLog
// table. Daily — audit rows have a 30-day retention so a daily sweep is
// sufficient and keeps cron-budget usage low.
crons.daily(
  'cleanup-expired-bg-location-audit-log',
  { hourUTC: 3, minuteUTC: 40 },
  internal.crossedPaths.cleanupExpiredBgLocationAuditLog
);

// Phase 1 Background Crossed Paths: stale-row sweep for locationBatchRateLimit.
// Daily — drops rows whose updatedAt is older than 7 days so a user that
// has stopped sampling does not accumulate counter rows forever.
crons.daily(
  'cleanup-stale-location-batch-rate-limit',
  { hourUTC: 3, minuteUTC: 55 },
  internal.crossedPaths.cleanupStaleLocationBatchRateLimit
);

// Phase-2 Ranking: Cleanup old viewer impressions daily
// Removes impressions older than 7 days to prevent unbounded table growth
crons.daily(
  'cleanup-old-viewer-impressions',
  { hourUTC: 4, minuteUTC: 0 },
  internal.phase2Ranking.cleanupOldImpressions
);

export default crons;

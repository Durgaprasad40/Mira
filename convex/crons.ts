import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// 4-2: Cleanup expired notifications every hour
crons.hourly(
  'cleanup-expired-notifications',
  { minuteUTC: 30 }, // Run at :30 past each hour
  internal.notifications.cleanupExpiredNotifications
);

// 8C: Cleanup verification photos older than 90 days (daily at 3:00 AM UTC)
crons.daily(
  'cleanup-verification-photos',
  { hourUTC: 3, minuteUTC: 0 },
  internal.verification.cleanupOldVerificationPhotos
);

// ToD: Cleanup expired Truth/Dare data every 15 minutes
// Cascade deletes expired prompts, answers, likes, connect requests, and private media
crons.interval(
  'cleanup-expired-tod-data',
  { minutes: 15 },
  internal.truthDare.cleanupExpiredTodData
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

// CR-012: Phase-2 Chat Rooms: Cleanup expired messages every 15 minutes
// Each message expires 24h after its createdAt timestamp
// This ensures time-based retention even for inactive rooms
crons.interval(
  'cleanup-expired-chat-room-messages',
  { minutes: 15 },
  internal.chatRooms.cleanupExpiredMessages
);

// B2-FIX: Retry failed storage deletions every 30 minutes
// Cleans up orphaned storage blobs from failed photo deletions
crons.interval(
  'retry-failed-storage-deletions',
  { minutes: 30 },
  internal.photos.retryFailedStorageDeletions
);

// Nearby/Crossed Paths: Cleanup expired crossed path history every 6 hours
// Removes history entries past their 4-week expiration
crons.interval(
  'cleanup-expired-crossed-path-history',
  { hours: 6 },
  internal.crossedPaths.cleanupExpiredHistory
);

// Nearby/Crossed Paths: Cleanup expired crossed events every hour
// Removes crossed events past their 7-day expiration
crons.hourly(
  'cleanup-expired-crossed-events',
  { minuteUTC: 15 },
  internal.crossedPaths.cleanupExpiredCrossedEvents
);

// Phase-2 Ranking: Cleanup old viewer impressions daily
// Removes impressions older than 7 days to prevent unbounded table growth
crons.daily(
  'cleanup-old-viewer-impressions',
  { hourUTC: 4, minuteUTC: 0 },
  internal.phase2Ranking.cleanupOldImpressions
);

export default crons;

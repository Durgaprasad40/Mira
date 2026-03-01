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

// Phase-2 Chat Rooms: Cleanup expired rooms every 15 minutes
// Deletes rooms past their 24h expiresAt, along with all messages/members/penalties
crons.interval(
  'cleanup-expired-chat-rooms',
  { minutes: 15 },
  internal.chatRooms.cleanupExpiredRooms
);

// Phase-2 Chat Rooms: Cleanup expired penalties every hour
// Removes penalty records past their 24h expiration
crons.hourly(
  'cleanup-expired-chat-room-penalties',
  { minuteUTC: 45 },
  internal.chatRooms.cleanupExpiredPenalties
);

export default crons;

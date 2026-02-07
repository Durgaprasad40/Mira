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

export default crons;

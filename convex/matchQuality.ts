import { v } from 'convex/values';
import { query } from './_generated/server';

// Calculate match quality score (0-5) between two users
export const calculateMatchQuality = query({
  args: {
    userId1: v.id('users'),
    userId2: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { userId1, userId2 } = args;

    const user1 = await ctx.db.get(userId1);
    const user2 = await ctx.db.get(userId2);

    if (!user1 || !user2) return 0;

    let score = 0;
    let factors = 0;

    // 1. Relationship Intent Match (0-1 point)
    if (user1.relationshipIntent && user2.relationshipIntent) {
      const commonIntents = user1.relationshipIntent.filter((intent) =>
        user2.relationshipIntent?.includes(intent)
      );
      if (commonIntents.length > 0) {
        score += 1;
      }
      factors++;
    }

    // 2. Activities Match (0-1 point)
    if (user1.activities && user2.activities) {
      const commonActivities = user1.activities.filter((activity) =>
        user2.activities?.includes(activity)
      );
      if (commonActivities.length > 0) {
        score += Math.min(1, commonActivities.length / 3); // Max 1 point for 3+ common activities
      }
      factors++;
    }

    // 3. Age Compatibility (0-0.5 points)
    const user1Age = calculateAge(user1.dateOfBirth);
    const user2Age = calculateAge(user2.dateOfBirth);
    if (
      user1Age >= user2.minAge &&
      user1Age <= user2.maxAge &&
      user2Age >= user1.minAge &&
      user2Age <= user1.maxAge
    ) {
      score += 0.5;
    }
    factors++;

    // 4. Distance (0-0.5 points) - Closer = better
    if (user1.latitude && user1.longitude && user2.latitude && user2.longitude) {
      const distance = calculateDistance(
        user1.latitude,
        user1.longitude,
        user2.latitude,
        user2.longitude
      );
      const maxDistance = Math.max(user1.maxDistance, user2.maxDistance);
      if (distance <= maxDistance) {
        const distanceScore = 1 - distance / maxDistance; // Closer = higher score
        score += distanceScore * 0.5;
      }
    }
    factors++;

    // 5. Lifestyle Match (0-0.5 points)
    let lifestyleMatches = 0;
    if (user1.smoking === user2.smoking) lifestyleMatches++;
    if (user1.drinking === user2.drinking) lifestyleMatches++;
    if (user1.exercise === user2.exercise) lifestyleMatches++;
    if (user1.education === user2.education) lifestyleMatches++;
    score += (lifestyleMatches / 4) * 0.5;
    factors++;

    // 6. Profile Completion (0-0.5 points)
    let completion1 = 0;
    let completion2 = 0;
    if (user1.bio) completion1 += 0.2;
    if (user1.height) completion1 += 0.1;
    if (user1.jobTitle) completion1 += 0.1;
    if (user1.education) completion1 += 0.1;
    // if (user1.photos && user1.photos.length >= 3) completion1 += 0.5;

    if (user2.bio) completion2 += 0.2;
    if (user2.height) completion2 += 0.1;
    if (user2.jobTitle) completion2 += 0.1;
    if (user2.education) completion2 += 0.1;
    // if (user2.photos && user2.photos.length >= 3) completion2 += 0.5;

    const avgCompletion = (completion1 + completion2) / 2;
    score += avgCompletion * 0.5;
    factors++;

    // 7. Verification Status (0-0.5 points)
    if (user1.isVerified && user2.isVerified) {
      score += 0.5;
    } else if (user1.isVerified || user2.isVerified) {
      score += 0.25;
    }
    factors++;

    // Normalize to 0-5 scale
    const normalizedScore = (score / factors) * 5;

    return Math.min(5, Math.max(0, normalizedScore));
  },
});

function calculateAge(dateOfBirth: string): number {
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

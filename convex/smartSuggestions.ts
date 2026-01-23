import { v } from 'convex/values';
import { query } from './_generated/server';

// Get smart suggestions based on popular filters
export const getSmartSuggestions = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const { userId } = args;

    const currentUser = await ctx.db.get(userId);
    if (!currentUser) return [];

    const now = Date.now();
    const todayStart = new Date(now).setHours(0, 0, 0, 0);
    const tonightEnd = new Date(now).setHours(23, 59, 59, 999);

    // Get all active users
    const allUsers = await ctx.db
      .query('users')
      .filter((q) => q.eq(q.field('isActive'), true))
      .collect();

    // Count popular filters
    const activityCounts: Record<string, number> = {};
    const intentCounts: Record<string, number> = {};
    let tonightCount = 0;
    let weekendCount = 0;

    for (const user of allUsers) {
      // Count activities
      if (user.activities) {
        for (const activity of user.activities) {
          activityCounts[activity] = (activityCounts[activity] || 0) + 1;
        }
      }

      // Count relationship intents
      if (user.relationshipIntent) {
        for (const intent of user.relationshipIntent) {
          intentCounts[intent] = (intentCounts[intent] || 0) + 1;
        }
      }

      // Count "free tonight" (users active today)
      if (user.lastActive >= todayStart && user.lastActive <= tonightEnd) {
        if (user.activities?.includes('free_tonight')) {
          tonightCount++;
        }
      }

      // Count "this weekend" (users active this week)
      const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;
      if (user.lastActive >= weekStart) {
        if (user.activities?.includes('this_weekend')) {
          weekendCount++;
        }
      }
    }

    // Build suggestions
    const suggestions = [];

    // Most active activities
    const topActivities = Object.entries(activityCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([activity, count]) => ({
        id: `activity-${activity}`,
        label: formatActivityLabel(activity),
        icon: getActivityIcon(activity),
        count,
        filters: {
          activities: [activity],
        },
      }));

    suggestions.push(...topActivities);

    // Most common intents
    const topIntents = Object.entries(intentCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([intent, count]) => ({
        id: `intent-${intent}`,
        label: formatIntentLabel(intent),
        icon: getIntentIcon(intent),
        count,
        filters: {
          relationshipIntents: [intent],
        },
      }));

    suggestions.push(...topIntents);

    // Time-based suggestions
    if (tonightCount > 0) {
      suggestions.push({
        id: 'tonight',
        label: 'Free Tonight',
        icon: '🌙',
        count: tonightCount,
        filters: {
          timeFilters: ['tonight'],
          activities: ['free_tonight'],
        },
      });
    }

    if (weekendCount > 0) {
      suggestions.push({
        id: 'weekend',
        label: 'This Weekend',
        icon: '📅',
        count: weekendCount,
        filters: {
          timeFilters: ['this_weekend'],
          activities: ['this_weekend'],
        },
      });
    }

    // Sort by count
    suggestions.sort((a, b) => b.count - a.count);

    return suggestions.slice(0, 10);
  },
});

function formatActivityLabel(activity: string): string {
  const labels: Record<string, string> = {
    coffee: 'Coffee Date',
    date_night: 'Date Night',
    sports: 'Sports & Fitness',
    movies: 'Movies',
    free_tonight: 'Free Tonight',
    foodie: 'Foodie Dates',
    gym_partner: 'Gym Partner',
    concerts: 'Concerts',
    travel: 'Travel',
    outdoors: 'Outdoors',
    art_culture: 'Art & Culture',
    gaming: 'Gaming',
    nightlife: 'Nightlife',
    brunch: 'Brunch',
    study_date: 'Study Date',
    this_weekend: 'This Weekend',
    beach_pool: 'Beach/Pool',
    road_trip: 'Road Trip',
    photography: 'Photography',
    volunteering: 'Volunteering',
  };
  return labels[activity] || activity;
}

function getActivityIcon(activity: string): string {
  const icons: Record<string, string> = {
    coffee: '☕',
    date_night: '🍷',
    sports: '🏃',
    movies: '🎬',
    free_tonight: '🌙',
    foodie: '🍕',
    gym_partner: '💪',
    concerts: '🎵',
    travel: '✈️',
    outdoors: '🏕️',
    art_culture: '🎨',
    gaming: '🎮',
    nightlife: '🍻',
    brunch: '🥂',
    study_date: '📚',
    this_weekend: '📅',
    beach_pool: '🏖️',
    road_trip: '🚗',
    photography: '📸',
    volunteering: '🤲',
  };
  return icons[activity] || '⭐';
}

function formatIntentLabel(intent: string): string {
  const labels: Record<string, string> = {
    long_term: 'Long-term',
    short_term: 'Short-term',
    fwb: 'Friends with Benefits',
    figuring_out: 'Figuring It Out',
    short_to_long: 'Short → Long',
    long_to_short: 'Long → Short',
    new_friends: 'New Friends',
    open_to_anything: 'Open to Anything',
  };
  return labels[intent] || intent;
}

function getIntentIcon(intent: string): string {
  const icons: Record<string, string> = {
    long_term: '💕',
    short_term: '💫',
    fwb: '🔥',
    figuring_out: '🤔',
    short_to_long: '💫→💕',
    long_to_short: '💕→💫',
    new_friends: '🤝',
    open_to_anything: '🌟',
  };
  return icons[intent] || '💫';
}

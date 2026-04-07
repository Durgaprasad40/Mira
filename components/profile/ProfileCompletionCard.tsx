/**
 * ProfileCompletionCard Component
 *
 * PHASE-1: Non-blocking profile completion nudge card.
 * Shows completion percentage, progress bar, and top 3 actions.
 *
 * RULES:
 * - Never blocks user actions
 * - Dismissible (remembers dismiss for session)
 * - Links to edit sections for each action
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS } from '@/lib/constants';
import {
  getProfileCompletion,
  getCompletionStatusMessage,
  getCompletionTier,
  ACTION_DESCRIPTIONS,
  ProfileField,
  UserProfileData,
} from '@/lib/profileCompletion';

interface ProfileCompletionCardProps {
  userData: UserProfileData | null | undefined;
  onDismiss?: () => void;
  compact?: boolean;
}

export function ProfileCompletionCard({
  userData,
  onDismiss,
  compact = false,
}: ProfileCompletionCardProps) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);

  // Calculate completion
  const completion = getProfileCompletion(userData);
  const statusMessage = getCompletionStatusMessage(completion.percentage);
  const tier = getCompletionTier(completion.percentage);

  // Get tier color
  const getTierColor = () => {
    switch (tier) {
      case 'complete': return COLORS.success;
      case 'great': return '#4CAF50';
      case 'good': return COLORS.primary;
      case 'basic': return '#FFA000';
      default: return COLORS.textMuted;
    }
  };

  const tierColor = getTierColor();

  // Handle action tap - navigate to edit section
  const handleActionTap = useCallback((action: ProfileField) => {
    if (action.editRoute === 'edit-profile') {
      // Navigate to edit-profile with section param
      router.push({
        pathname: '/(main)/edit-profile',
        params: action.editSection ? { scrollTo: action.editSection } : {},
      });
    } else if (action.editRoute === 'face-verification') {
      // Navigate to face verification
      router.push('/(onboarding)/face-verification' as any);
    }
  }, [router]);

  // Handle dismiss
  const handleDismiss = useCallback(() => {
    setDismissed(true);
    onDismiss?.();
  }, [onDismiss]);

  // Don't show if dismissed or 100% complete
  if (dismissed || completion.percentage >= 100) {
    return null;
  }

  // Compact version for Discover banner
  if (compact) {
    return (
      <TouchableOpacity
        style={styles.compactContainer}
        onPress={() => router.push('/(main)/(tabs)/profile')}
        activeOpacity={0.8}
      >
        <View style={styles.compactContent}>
          <View style={[styles.compactIcon, { backgroundColor: tierColor + '20' }]}>
            <Ionicons name="person-circle-outline" size={20} color={tierColor} />
          </View>
          <View style={styles.compactTextContainer}>
            <Text style={styles.compactTitle}>
              Profile {completion.percentage}% complete
            </Text>
            <Text style={styles.compactSubtitle} numberOfLines={1}>
              Complete your profile to get more matches
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
        </View>
        <View style={styles.compactProgressContainer}>
          <View style={[styles.compactProgressBar, { width: `${completion.percentage}%`, backgroundColor: tierColor }]} />
        </View>
      </TouchableOpacity>
    );
  }

  // Full card for Profile tab
  return (
    <View style={styles.container}>
      {/* Header with dismiss */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.iconContainer, { backgroundColor: tierColor + '20' }]}>
            <Ionicons name="sparkles" size={20} color={tierColor} />
          </View>
          <View>
            <Text style={styles.title}>Profile Completion</Text>
            <Text style={styles.percentage}>{completion.percentage}%</Text>
          </View>
        </View>
        <TouchableOpacity onPress={handleDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={20} color={COLORS.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Progress bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBackground}>
          <View
            style={[
              styles.progressBar,
              { width: `${completion.percentage}%`, backgroundColor: tierColor },
            ]}
          />
        </View>
      </View>

      {/* Status message */}
      <Text style={styles.statusMessage}>{statusMessage}</Text>

      {/* Next actions */}
      {completion.nextBestActions.length > 0 && (
        <View style={styles.actionsContainer}>
          <Text style={styles.actionsTitle}>Complete to boost your profile:</Text>
          {completion.nextBestActions.map((action, index) => (
            <TouchableOpacity
              key={action.key}
              style={styles.actionItem}
              onPress={() => handleActionTap(action)}
              activeOpacity={0.7}
            >
              <View style={styles.actionLeft}>
                <View style={[styles.actionBullet, { backgroundColor: tierColor }]}>
                  <Text style={styles.actionBulletText}>{index + 1}</Text>
                </View>
                <Text style={styles.actionText}>
                  {ACTION_DESCRIPTIONS[action.key]}
                </Text>
              </View>
              <View style={styles.actionRight}>
                <Text style={styles.actionPoints}>+{action.points}%</Text>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textLight,
    marginBottom: 2,
  },
  percentage: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
  },
  progressContainer: {
    marginBottom: 12,
  },
  progressBackground: {
    height: 8,
    backgroundColor: COLORS.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 4,
  },
  statusMessage: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 16,
    lineHeight: 20,
  },
  actionsContainer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 12,
  },
  actionsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border + '50',
  },
  actionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  actionBullet: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBulletText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.white,
  },
  actionText: {
    fontSize: 14,
    color: COLORS.text,
    flex: 1,
  },
  actionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionPoints: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  // Compact styles (for Discover banner)
  compactContainer: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  compactContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  compactIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactTextContainer: {
    flex: 1,
  },
  compactTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  compactSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  compactProgressContainer: {
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    marginTop: 10,
    overflow: 'hidden',
  },
  compactProgressBar: {
    height: '100%',
    borderRadius: 2,
  },
});

export default ProfileCompletionCard;

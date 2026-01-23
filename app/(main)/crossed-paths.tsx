import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, CROSSED_PATHS } from '@/lib/constants';
import { Avatar } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

export default function CrossedPathsScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();

  const crossedPaths = useQuery(
    api.crossedPaths.getCrossedPaths,
    userId ? { userId: userId as any } : 'skip'
  );

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days} day${days > 1 ? 's' : ''} ago`;
    } else if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
      return 'Recently';
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Crossed Paths</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.infoBanner}>
        <Ionicons name="information-circle" size={20} color={COLORS.primary} />
        <Text style={styles.infoText}>
          You've crossed paths with these people! {CROSSED_PATHS.MIN_CROSSINGS_FOR_UNLOCK}+
          crossings unlock 48 hours of free messaging.
        </Text>
      </View>

      <FlatList
        data={crossedPaths || []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.pathCard}
            onPress={() => router.push(`/(main)/profile/${item.user.id}`)}
          >
            {item.user.photoUrl ? (
              <Image
                source={{ uri: item.user.photoUrl }}
                style={styles.avatar}
                contentFit="cover"
              />
            ) : (
              <Avatar size={60} />
            )}
            <View style={styles.pathInfo}>
              <View style={styles.pathHeader}>
                <Text style={styles.pathName}>{item.user.name}</Text>
                {item.user.isVerified && (
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.primary} />
                )}
              </View>
              <View style={styles.pathDetails}>
                <Ionicons name="location" size={14} color={COLORS.textLight} />
                <Text style={styles.pathLocation}>
                  {item.count} {item.count === 1 ? 'crossing' : 'crossings'}
                </Text>
                <Text style={styles.pathSeparator}>•</Text>
                <Text style={styles.pathTime}>{formatTime(item.lastCrossedAt)}</Text>
              </View>
              {item.isUnlocked && item.unlockExpiresAt && (
                <View style={styles.unlockBadge}>
                  <Ionicons name="unlock" size={14} color={COLORS.success} />
                  <Text style={styles.unlockText}>
                    Free messaging until{' '}
                    {new Date(item.unlockExpiresAt).toLocaleDateString()}
                  </Text>
                </View>
              )}
              {!item.isUnlocked && item.count >= CROSSED_PATHS.MIN_CROSSINGS_FOR_UNLOCK && (
                <View style={styles.unlockBadge}>
                  <Ionicons name="lock-open" size={14} color={COLORS.warning} />
                  <Text style={styles.unlockText}>
                    {item.count}/{CROSSED_PATHS.MIN_CROSSINGS_FOR_UNLOCK} crossings - Unlock messaging!
                  </Text>
                </View>
              )}
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="location-outline" size={64} color={COLORS.textLight} />
            <Text style={styles.emptyTitle}>No crossed paths yet</Text>
            <Text style={styles.emptySubtitle}>
              Enable location services to see people you've crossed paths with
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
  },
  infoBanner: {
    flexDirection: 'row',
    backgroundColor: COLORS.primary + '20',
    padding: 16,
    margin: 16,
    borderRadius: 12,
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 18,
  },
  pathCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginRight: 12,
  },
  pathInfo: {
    flex: 1,
  },
  pathHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 6,
  },
  pathName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  pathDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pathLocation: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  pathSeparator: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  pathTime: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  unlockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.success + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 6,
    gap: 4,
  },
  unlockText: {
    fontSize: 11,
    color: COLORS.success,
    fontWeight: '500',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },
});

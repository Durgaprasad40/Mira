/**
 * Debug Event Log Screen — Demo/Dev only
 *
 * Shows the last 30 important events for debugging.
 * Access from QA Checklist screen.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { COLORS } from '@/lib/constants';
import { isDemoMode } from '@/hooks/useConvex';
import {
  getDebugEvents,
  clearDebugEvents,
  subscribeToDebugEvents,
  EVENT_TYPE_LABELS,
  DebugEvent,
} from '@/lib/debugEventLogger';

// Format relative time (e.g., "2m ago", "1h ago")
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Color coding for event types
const EVENT_COLORS: Record<string, string> = {
  MATCH_CREATED: '#10B981', // green
  CONFESSION_CREATED: '#8B5CF6', // purple
  CONFESSION_TAGGED: '#F59E0B', // amber
  TAG_NOTIFICATION: '#F59E0B', // amber
  CHAT_UNLOCKED: '#10B981', // green
  CHAT_EXPIRED: '#EF4444', // red
  NEARBY_CROSSED: '#3B82F6', // blue
  BLOCK_OR_REPORT: '#EF4444', // red
};

export default function QADebugLogScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<DebugEvent[]>(getDebugEvents());

  // Subscribe to event changes for live updates
  useEffect(() => {
    const unsubscribe = subscribeToDebugEvents(() => {
      setEvents(getDebugEvents());
    });
    return unsubscribe;
  }, []);

  // Guard: only accessible in demo/dev mode
  if (!isDemoMode && !__DEV__) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Debug Log</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Not available in production</Text>
        </View>
      </SafeAreaView>
    );
  }

  const handleClear = useCallback(() => {
    Alert.alert('Clear Log', 'Are you sure you want to clear all events?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          clearDebugEvents();
          setEvents([]);
        },
      },
    ]);
  }, []);

  // Format log for export
  const formatLogForExport = useCallback(() => {
    const header = `Mira Debug Log - ${new Date().toISOString()}\n${'='.repeat(40)}\n\n`;
    const body = events
      .map((e) => `[${new Date(e.time).toISOString()}] ${e.type}: ${e.message}`)
      .join('\n');
    return header + body;
  }, [events]);

  const handleCopyAll = useCallback(async () => {
    await Clipboard.setStringAsync(formatLogForExport());
    Alert.alert('Copied', 'All events copied to clipboard');
  }, [formatLogForExport]);

  const handleShare = useCallback(async () => {
    try {
      await Share.share({
        message: formatLogForExport(),
        title: 'Mira Debug Log',
      });
    } catch (error) {
      // User cancelled or share failed silently
    }
  }, [formatLogForExport]);

  const renderItem = useCallback(({ item }: { item: DebugEvent }) => {
    const color = EVENT_COLORS[item.type] || COLORS.textLight;
    return (
      <View style={styles.eventRow}>
        <View style={styles.eventLeft}>
          <View style={[styles.eventDot, { backgroundColor: color }]} />
          <View style={styles.eventContent}>
            <View style={styles.eventHeader}>
              <Text style={[styles.eventType, { color }]}>
                {EVENT_TYPE_LABELS[item.type] || item.type}
              </Text>
              <Text style={styles.eventTime}>{formatRelativeTime(item.time)}</Text>
            </View>
            <Text style={styles.eventMessage}>{item.message}</Text>
          </View>
        </View>
      </View>
    );
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Debug Event Log</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionButton} onPress={handleClear}>
          <Ionicons name="trash-outline" size={18} color={COLORS.error} />
          <Text style={[styles.actionText, { color: COLORS.error }]}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={handleCopyAll}>
          <Ionicons name="copy-outline" size={18} color={COLORS.primary} />
          <Text style={[styles.actionText, { color: COLORS.primary }]}>Copy</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
          <Ionicons name="share-outline" size={18} color="#10B981" />
          <Text style={[styles.actionText, { color: '#10B981' }]}>Share</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.countBadge}>
        <Text style={styles.countText}>{events.length} events (max 30)</Text>
      </View>

      {events.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="document-text-outline" size={48} color={COLORS.border} />
          <Text style={styles.emptyText}>No events logged yet</Text>
          <Text style={styles.emptySubtext}>
            Events will appear as you interact with the app
          </Text>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(item, index) => `${item.time}-${index}`}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    padding: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  placeholder: {
    width: 32,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: COLORS.backgroundDark,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '500',
  },
  countBadge: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  countText: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  eventRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  eventLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  eventDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    marginRight: 12,
  },
  eventContent: {
    flex: 1,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  eventType: {
    fontSize: 13,
    fontWeight: '600',
  },
  eventTime: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  eventMessage: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.textLight,
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
});

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { DEMO_PROFILES } from '@/lib/demoData';
import { useDemoStore } from '@/stores/demoStore';
import { useInteractionStore } from '@/stores/interactionStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { asUserId } from '@/convex/id';

interface PersonItem {
  id: string;
  name: string;
  photoUrl: string | null;
}

export default function PersonPickerScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const { userId } = useAuthStore();

  // Demo mode data
  const storeMatches = useDemoStore((s) => s.matches);

  // Convex query for eligible tag targets (only in live mode)
  const convexUserId = !isDemoMode && userId ? asUserId(userId) : undefined;
  const convexTargets = useQuery(
    api.confessions.getEligibleTagTargets,
    convexUserId ? { userId: convexUserId } : 'skip'
  );

  // Determine loading state
  const isLoading = !isDemoMode && convexTargets === undefined;

  // Build people list based on mode
  const people: PersonItem[] = useMemo(() => {
    if (!isDemoMode) {
      // Live mode: use Convex query results
      if (!convexTargets) return [];
      return convexTargets.map((t) => ({
        id: t.id,
        name: t.name,
        photoUrl: t.photoUrl,
      }));
    }

    // Demo mode: use store matches + demo profiles
    const fromMatches: PersonItem[] = storeMatches.map((m) => ({
      id: m.otherUser.id,
      name: m.otherUser.name,
      photoUrl: m.otherUser.photoUrl,
    }));
    const fromProfiles: PersonItem[] = DEMO_PROFILES.map((p) => ({
      id: p._id,
      name: p.name,
      photoUrl: p.photos[0]?.url || null,
    }));

    const seen = new Set<string>();
    const all: PersonItem[] = [];
    for (const person of [...fromMatches, ...fromProfiles]) {
      if (!seen.has(person.id)) {
        seen.add(person.id);
        all.push(person);
      }
    }
    return all;
  }, [isDemoMode, convexTargets, storeMatches]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return people;
    const q = search.toLowerCase();
    return people.filter((p) => p.name.toLowerCase().includes(q));
  }, [people, search]);

  const handleSelect = (personId: string, name: string) => {
    useInteractionStore.getState().setPersonPickerResult({ userId: personId, name });
    router.back();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Confess to Someone</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={COLORS.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search..."
          placeholderTextColor={COLORS.textMuted}
          value={search}
          onChangeText={setSearch}
          autoFocus
        />
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.personRow}
              onPress={() => handleSelect(item.id, item.name)}
            >
              <Image
                source={{ uri: item.photoUrl || undefined }}
                style={styles.personPhoto}
                contentFit="cover"
              />
              <Text style={styles.personName}>{item.name}</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="heart-outline" size={48} color={COLORS.textMuted} />
              <Text style={styles.emptyTitle}>No one to tag yet</Text>
              <Text style={styles.emptyText}>
                Like or match with someone first to confess to them.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
  },
  list: {
    paddingBottom: 40,
    flexGrow: 1,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  personPhoto: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.backgroundDark,
  },
  personName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.textMuted,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 80,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 15,
    color: COLORS.textMuted,
    lineHeight: 22,
  },
});

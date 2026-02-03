import React, { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { DEMO_PROFILES } from '@/lib/demoData';

const EMPTY_PROFILES: any[] = [];
const EMPTY_LIST: any[] = [];

// Map existing profile fields to Explore category tag IDs
const INTENT_TO_TAG: Record<string, string> = {
  long_term: 'long_term',
  short_to_long: 'long_term',
  short_term: 'short_term',
  fwb: 'short_term',
  new_friends: 'new_friends',
  open_to_anything: 'new_friends',
  figuring_out: 'new_friends',
};

const ACTIVITY_TAGS = new Set(['coffee', 'travel', 'gaming', 'outdoors']);

const getDistanceKm = (p: any): number | undefined => {
  if (typeof p.distanceKm === 'number') return p.distanceKm;
  if (typeof p.distance === 'number') return p.distance;
  return undefined;
};

function profileTags(p: any): string[] {
  const tags = new Set<string>();
  const intents = Array.isArray(p.relationshipIntent) ? p.relationshipIntent : EMPTY_LIST;
  for (const intent of intents) {
    const t = INTENT_TO_TAG[intent];
    if (t) tags.add(t);
  }
  const acts = Array.isArray(p.activities) ? p.activities : EMPTY_LIST;
  for (const act of acts) {
    if (ACTIVITY_TAGS.has(act)) tags.add(act);
  }
  const dist = getDistanceKm(p);
  if (dist !== undefined && dist <= 5) tags.add('near_me');
  return [...tags];
}

const DEMO_PROFILES_TAGGED = DEMO_PROFILES.map((p) => ({
  ...p,
  tags: profileTags(p),
}));

const SCREEN_WIDTH = Dimensions.get('window').width;
const H_PAD = 16;
const COL_GAP = 10;
const ROW_GAP = 10;
const CARD_W = (SCREEN_WIDTH - H_PAD * 2 - COL_GAP) / 2;
const CARD_H = 100;

const SECTIONS = [
  {
    title: 'Connection Goals',
    cats: [
      { id: 'long_term',  label: 'Long-term',     icon: 'heart',       color: '#E91E63', bg: '#FCE4EC' },
      { id: 'short_term', label: 'Casual Dating',  icon: 'flash',       color: '#FF9800', bg: '#FFF3E0' },
      { id: 'new_friends', label: 'New Friends',   icon: 'people',      color: '#4CAF50', bg: '#E8F5E9' },
      { id: 'near_me',    label: 'Near Me',        icon: 'location',    color: '#00BCD4', bg: '#E0F7FA' },
    ],
  },
  {
    title: 'Interests',
    cats: [
      { id: 'coffee',  label: 'Coffee & Cafe', icon: 'cafe',       color: '#795548', bg: '#EFEBE9' },
      { id: 'travel',  label: 'Travel',        icon: 'airplane',   color: '#00BCD4', bg: '#E0F7FA' },
      { id: 'gaming',  label: 'Gaming',        icon: 'game-controller', color: '#4CAF50', bg: '#E8F5E9' },
      { id: 'outdoors', label: 'Outdoors',     icon: 'leaf',       color: '#388E3C', bg: '#E8F5E9' },
    ],
  },
];

function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.userId);
  const [selected, setSelectedRaw] = useState<any>(null);
  const didInitSelectedRef = useRef(false);

  const setSelected = useCallback((next: any) => {
    setSelectedRaw((prev: any) => (prev?.id === next?.id ? prev : next));
  }, []);

  // One-shot default selection
  useEffect(() => {
    if (didInitSelectedRef.current) return;
    if (selected != null) {
      didInitSelectedRef.current = true;
      return;
    }

    const first = SECTIONS?.[0]?.cats?.[0] ?? null;
    if (first) {
      didInitSelectedRef.current = true;
      setSelected(first);
    }
  }, [selected, setSelected]);

  // Convex hooks — unconditional, skipped in demo
  const queryArgs = useMemo(() => {
    if (isDemoMode || !userId) return 'skip' as const;
    return { userId: userId as any };
  }, [userId]);
  const convexProfiles = useQuery(api.discover.getExploreProfiles, queryArgs);

  const visibleProfiles = useMemo(() => {
    if (isDemoMode) return DEMO_PROFILES_TAGGED;
    return Array.isArray(convexProfiles) ? convexProfiles : EMPTY_PROFILES;
  }, [convexProfiles]);

  const filteredProfiles = useMemo(() => {
    if (!visibleProfiles.length) return EMPTY_PROFILES;
    const selId = selected?.id;
    if (!selId) return visibleProfiles;

    let out: any[];
    if (selId === 'near_me') {
      out = visibleProfiles.filter((p: any) => {
        const d = getDistanceKm(p);
        return d !== undefined && d <= 5;
      });
    } else {
      out = visibleProfiles.filter((p: any) => Array.isArray(p.tags) && p.tags.includes(selId));
    }

    // Filter out banned/blocked/hidden (live mode)
    if (!isDemoMode) {
      out = out.filter((p: any) => !p.isBanned && !p.isBlocked && !p.isHidden);
    }

    return out.length ? out : EMPTY_PROFILES;
  }, [visibleProfiles, selected?.id]);

  const people = filteredProfiles.slice(0, 6);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.title}>Explore</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionLabel}>{section.title}</Text>
            <View style={styles.grid}>
              {section.cats.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.card, { backgroundColor: cat.bg, borderWidth: selected?.id === cat.id ? 2 : 0, borderColor: cat.color }]}
                  onPress={() => setSelected(cat)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.iconCircle, { backgroundColor: cat.color + '20' }]}>
                    <Ionicons name={cat.icon as any} size={24} color={cat.color} />
                  </View>
                  <Text style={[styles.cardLabel, { color: cat.color }]}>{cat.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {people.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>People to Meet</Text>
            <View style={styles.grid}>
              {people.map((profile: any) => (
                <View
                  key={profile._id}
                  style={[styles.card, { backgroundColor: '#F3E5F5', height: CARD_H + 20 }]}
                >
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#7B1FA2' }} numberOfLines={1}>
                    {profile.name}, {profile.age}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#9C27B0' }} numberOfLines={1}>
                    {profile.city} {getDistanceKm(profile) ? `· ${getDistanceKm(profile)} km` : ''}
                  </Text>
                  <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }} numberOfLines={2}>
                    {profile.bio}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>
              No matches yet. Try another category or complete your profile.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

export default memo(ExploreScreen);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { paddingHorizontal: H_PAD, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E0E0E0' },
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a1a' },
  scroll: { paddingHorizontal: H_PAD, paddingTop: 16, paddingBottom: 40 },
  section: { marginBottom: 22 },
  sectionLabel: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: COL_GAP, rowGap: ROW_GAP },
  card: { width: CARD_W, height: CARD_H, borderRadius: 16, padding: 14, justifyContent: 'space-between' },
  iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cardLabel: { fontSize: 15, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 12, paddingHorizontal: 32 },
});

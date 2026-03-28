import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import { DEMO_INCOGNITO_PROFILES } from '@/lib/demoData';
import { isDemoMode } from '@/hooks/useConvex';
import { usePrivateChatStore } from '@/stores/privateChatStore';
import { useScreenTrace } from '@/lib/devTrace';
import type { IncognitoProfile } from '@/types';

const C = INCOGNITO_COLORS;

export default function PrivateProfileViewScreen() {
  useScreenTrace('P2_PROFILE_VIEW');
  const { userId: profileUserId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentUserId = useAuthStore((s) => s.userId);

  // Demo mode: use local demo data
  const demoProfile: IncognitoProfile | undefined = isDemoMode
    ? DEMO_INCOGNITO_PROFILES.find((p) => p.id === profileUserId)
    : undefined;

  // Convex mode: fetch real Phase-2 profile
  const convexProfile = useQuery(
    api.privateDiscover.getProfileByUserId,
    !isDemoMode && profileUserId && currentUserId
      ? { userId: profileUserId as any, viewerId: currentUserId as any }
      : 'skip'
  );

  // Loading state for Convex query
  const isLoading = !isDemoMode && convexProfile === undefined;

  // Determine which profile to use
  const profile = isDemoMode ? demoProfile : convexProfile;

  const { conversations, createConversation, unlockUser } = usePrivateChatStore();

  // Loading state
  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </View>
    );
  }

  // Hard fallback: null profile
  if (profile === undefined || profile === null) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.emptyState}>
          <Ionicons name="person-outline" size={48} color={C.textLight} />
          <Text style={styles.emptyText}>Profile not available</Text>
        </View>
      </View>
    );
  }

  // Normalize profile data for both demo and Convex formats
  const isConvexProfile = 'userId' in profile;
  const profileId = isConvexProfile ? (profile as any).userId : (profile as any).id;
  const profileName = isConvexProfile ? (profile as any).nickname || (profile as any).name : (profile as any).username;
  const profileAge = profile.age;
  const profileGender = profile.gender;
  const profileCity = profile.city;
  const profileBio = isConvexProfile ? (profile as any).bio : (profile as any).bio;
  const profilePhotoUrl = isConvexProfile
    ? ((profile as any).photos?.[0]?.url || (profile as any).blurredPhotoUrl)
    : (profile as any).photoUrl;
  const profileIntentKeys = isConvexProfile
    ? (profile as any).intentKeys
    : ((profile as any).privateIntentKey ? [(profile as any).privateIntentKey] : []);
  const profileHobbies = isConvexProfile ? (profile as any).hobbies : (profile as any).hobbies;
  const profileDesires = isConvexProfile ? (profile as any).desireTagKeys : (profile as any).desires;
  const profileInterests = isConvexProfile ? (profile as any).interests : (profile as any).interests;
  const profileIsOnline = !isConvexProfile && (profile as any).isOnline;
  const profileFaceUnblurred = !isConvexProfile && (profile as any).faceUnblurred;

  const handleMessage = () => {
    if (!profile) return;

    // Check if conversation already exists with this user
    const existing = conversations.find((c) => c.participantId === profileId);
    if (existing) {
      router.push({ pathname: '/(main)/incognito-chat', params: { id: existing.id } } as any);
      return;
    }

    // Create new conversation
    const convoId = `ic_profile_${profileId}_${Date.now()}`;

    unlockUser({
      id: profileId,
      username: profileName,
      photoUrl: profilePhotoUrl,
      age: profileAge,
      source: 'tod', // Using 'tod' as connection source for Phase-2 profile views
      unlockedAt: Date.now(),
    });

    createConversation({
      id: convoId,
      participantId: profileId,
      participantName: profileName,
      participantAge: profileAge,
      participantPhotoUrl: profilePhotoUrl,
      lastMessage: 'Say hi!',
      lastMessageAt: Date.now(),
      unreadCount: 0,
      connectionSource: 'tod', // Using 'tod' for Phase-2 profile connections
    });

    router.push({ pathname: '/(main)/incognito-chat', params: { id: convoId } } as any);
  };

  const genderIcon = profileGender === 'male' ? 'male' : profileGender === 'female' ? 'female' : 'male-female';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Photo + basic info */}
        <View style={styles.photoSection}>
          <Image
            source={{ uri: profilePhotoUrl }}
            style={[styles.profilePhoto, !profileFaceUnblurred && styles.photoBlurred]}
            contentFit="cover"
            blurRadius={profileFaceUnblurred ? 0 : 20}
          />
          {profileIsOnline && <View style={styles.onlineDot} />}
        </View>

        <View style={styles.nameRow}>
          <Text style={styles.nameText}>{profileName}</Text>
          <Text style={styles.ageText}>{profileAge}</Text>
          <Ionicons name={genderIcon} size={16} color={C.textLight} />
        </View>

        {profileCity && (
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={14} color={C.textLight} />
            <Text style={styles.locationText}>{profileCity}</Text>
          </View>
        )}

        {/* Bio */}
        {profileBio ? (
          <View style={styles.section}>
            <Text style={styles.bioText}>{profileBio}</Text>
          </View>
        ) : null}

        {/* DESIRE - Phase 2 desires as text */}
        {profileDesires && profileDesires.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>DESIRE</Text>
            <Text style={styles.desireText}>{profileDesires.join(' • ')}</Text>
          </View>
        )}

        {/* LOOKING FOR - Phase 2 intent category */}
        {profileIntentKeys && profileIntentKeys.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>LOOKING FOR</Text>
            <View style={styles.intentChipRow}>
              {profileIntentKeys.map((intentKey: string, i: number) => {
                const intent = PRIVATE_INTENT_CATEGORIES.find(c => c.key === intentKey);
                if (!intent) return null;
                return (
                  <View key={i} style={[styles.intentChip, { borderColor: intent.color + '50' }]}>
                    <Ionicons name={intent.icon as any} size={16} color={intent.color} />
                    <Text style={[styles.intentChipText, { color: intent.color }]}>{intent.label}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Interests */}
        {profileInterests && profileInterests.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Interests</Text>
            <View style={styles.chipRow}>
              {profileInterests.map((interest: string, i: number) => (
                <View key={i} style={styles.chipAlt}>
                  <Text style={styles.chipAltText}>{interest}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Hobbies */}
        {profileHobbies && profileHobbies.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Hobbies</Text>
            <View style={styles.chipRow}>
              {profileHobbies.map((hobby: string, i: number) => (
                <View key={i} style={styles.chipAlt}>
                  <Text style={styles.chipAltText}>{hobby}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Details - only for demo profiles with this data */}
        {!isConvexProfile && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Details</Text>
            <View style={styles.detailsGrid}>
              {(profile as any).height ? (
                <View style={styles.detailItem}>
                  <Ionicons name="resize-outline" size={16} color={C.textLight} />
                  <Text style={styles.detailText}>{(profile as any).height} cm</Text>
                </View>
              ) : null}
              {(profile as any).bodyStructure ? (
                <View style={styles.detailItem}>
                  <Ionicons name="body-outline" size={16} color={C.textLight} />
                  <Text style={styles.detailText}>{(profile as any).bodyStructure}</Text>
                </View>
              ) : null}
              {(profile as any).hairColor ? (
                <View style={styles.detailItem}>
                  <Ionicons name="color-palette-outline" size={16} color={C.textLight} />
                  <Text style={styles.detailText}>{(profile as any).hairColor} hair</Text>
                </View>
              ) : null}
              {(profile as any).eyeColor ? (
                <View style={styles.detailItem}>
                  <Ionicons name="eye-outline" size={16} color={C.textLight} />
                  <Text style={styles.detailText}>{(profile as any).eyeColor} eyes</Text>
                </View>
              ) : null}
            </View>
          </View>
        )}

        {/* Desire categories - only for demo profiles */}
        {!isConvexProfile && (profile as any).desireCategories && (profile as any).desireCategories.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Vibe</Text>
            <View style={styles.chipRow}>
              {(profile as any).desireCategories.map((cat: string, i: number) => (
                <View key={i} style={styles.vibeChip}>
                  <Text style={styles.vibeChipText}>{cat}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Fixed bottom Message button */}
      <View style={[styles.messageBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TouchableOpacity style={styles.messageButton} onPress={handleMessage} activeOpacity={0.8}>
          <Ionicons name="chatbubble-ellipses-outline" size={20} color="#FFF" />
          <Text style={styles.messageButtonText}>Message</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  // Empty
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: C.textLight },
  // Scroll
  scrollContent: { paddingHorizontal: 16 },
  // Photo
  photoSection: { alignItems: 'center', marginTop: 20, marginBottom: 12 },
  profilePhoto: { width: 120, height: 120, borderRadius: 60, backgroundColor: C.accent },
  photoBlurred: { opacity: 0.85 },
  onlineDot: {
    position: 'absolute', bottom: 4, right: '35%',
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#00B894', borderWidth: 2, borderColor: C.background,
  },
  // Name
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 4 },
  nameText: { fontSize: 20, fontWeight: '700', color: C.text },
  ageText: { fontSize: 17, color: C.textLight },
  // Location
  locationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 16 },
  locationText: { fontSize: 13, color: C.textLight },
  distanceText: { fontSize: 12, color: C.textLight + 'AA', marginLeft: 4 },
  // Sections
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: C.textLight, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  bioText: { fontSize: 15, color: C.text, lineHeight: 22 },
  desireText: { fontSize: 15, color: C.text, lineHeight: 22, fontStyle: 'italic' },
  placeholderText: { fontSize: 14, color: C.textLight, fontStyle: 'italic' },
  intentChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  intentChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.surface, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 16, borderWidth: 1,
  },
  intentChipText: { fontSize: 14, fontWeight: '600' },
  // Chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: C.surface, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  chipText: { fontSize: 13, color: C.text },
  chipAlt: { backgroundColor: C.accent, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  chipAltText: { fontSize: 13, color: C.text },
  vibeChip: {
    backgroundColor: C.primary + '15', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12,
    borderWidth: 1, borderColor: C.primary + '30',
  },
  vibeChipText: { fontSize: 12, fontWeight: '600', color: C.primary, textTransform: 'capitalize' },
  // Details
  detailsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  detailItem: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.surface, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
  },
  detailText: { fontSize: 13, color: C.text, textTransform: 'capitalize' },
  // Message bar
  messageBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: C.background,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.surface,
  },
  messageButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, paddingVertical: 14, borderRadius: 14,
  },
  messageButtonText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
});

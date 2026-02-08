import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import { DEMO_INCOGNITO_PROFILES } from '@/lib/demoData';
import { usePrivateChatStore } from '@/stores/privateChatStore';
import type { IncognitoProfile } from '@/types';

const C = INCOGNITO_COLORS;

export default function PrivateProfileViewScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const profile: IncognitoProfile | undefined = DEMO_INCOGNITO_PROFILES.find(
    (p) => p.id === userId
  );

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

  const { conversations, createConversation, unlockUser } = usePrivateChatStore();

  const handleMessage = () => {
    if (!profile) return;

    // Check if conversation already exists with this user
    const existing = conversations.find((c) => c.participantId === profile.id);
    if (existing) {
      router.push({ pathname: '/(main)/incognito-chat', params: { id: existing.id } } as any);
      return;
    }

    // Create new conversation
    const convoId = `ic_profile_${profile.id}_${Date.now()}`;

    unlockUser({
      id: profile.id,
      username: profile.username,
      photoUrl: profile.photoUrl,
      age: profile.age,
      source: 'tod',
      unlockedAt: Date.now(),
    });

    createConversation({
      id: convoId,
      participantId: profile.id,
      participantName: profile.username,
      participantAge: profile.age,
      participantPhotoUrl: profile.photoUrl,
      lastMessage: 'Say hi!',
      lastMessageAt: Date.now(),
      unreadCount: 0,
      connectionSource: 'tod',
    });

    router.push({ pathname: '/(main)/incognito-chat', params: { id: convoId } } as any);
  };

  const genderIcon = profile.gender === 'male' ? 'male' : profile.gender === 'female' ? 'female' : 'male-female';

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
            source={{ uri: profile.photoUrl }}
            style={[styles.profilePhoto, !profile.faceUnblurred && styles.photoBlurred]}
            contentFit="cover"
            blurRadius={profile.faceUnblurred ? 0 : 20}
          />
          {profile.isOnline && <View style={styles.onlineDot} />}
        </View>

        <View style={styles.nameRow}>
          <Text style={styles.nameText}>{profile.username}</Text>
          <Text style={styles.ageText}>{profile.age}</Text>
          <Ionicons name={genderIcon} size={16} color={C.textLight} />
        </View>

        <View style={styles.locationRow}>
          <Ionicons name="location-outline" size={14} color={C.textLight} />
          <Text style={styles.locationText}>{profile.city}</Text>
          <Text style={styles.distanceText}>{profile.distance} km away</Text>
        </View>

        {/* Bio */}
        {profile.bio ? (
          <View style={styles.section}>
            <Text style={styles.bioText}>{profile.bio}</Text>
          </View>
        ) : null}

        {/* DESIRE - Phase 2 desires as text */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>DESIRE</Text>
          {profile.desires && profile.desires.length > 0 ? (
            <Text style={styles.desireText}>{profile.desires.join(' • ')}</Text>
          ) : (
            <Text style={styles.placeholderText}>No desire added yet</Text>
          )}
        </View>

        {/* LOOKING FOR - Phase 2 intent category */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>LOOKING FOR</Text>
          {profile.privateIntentKey ? (
            <View style={styles.intentChipRow}>
              {(() => {
                const intent = PRIVATE_INTENT_CATEGORIES.find(c => c.key === profile.privateIntentKey);
                if (!intent) return <Text style={styles.placeholderText}>Not set</Text>;
                return (
                  <View style={[styles.intentChip, { borderColor: intent.color + '50' }]}>
                    <Ionicons name={intent.icon as any} size={16} color={intent.color} />
                    <Text style={[styles.intentChipText, { color: intent.color }]}>{intent.label}</Text>
                  </View>
                );
              })()}
            </View>
          ) : (
            <Text style={styles.placeholderText}>Not set</Text>
          )}
        </View>

        {/* Interests */}
        {profile.interests && profile.interests.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Interests</Text>
            <View style={styles.chipRow}>
              {profile.interests.map((interest, i) => (
                <View key={i} style={styles.chipAlt}>
                  <Text style={styles.chipAltText}>{interest}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Hobbies */}
        {profile.hobbies && profile.hobbies.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Hobbies</Text>
            <View style={styles.chipRow}>
              {profile.hobbies.map((hobby, i) => (
                <View key={i} style={styles.chipAlt}>
                  <Text style={styles.chipAltText}>{hobby}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Details</Text>
          <View style={styles.detailsGrid}>
            {profile.height ? (
              <View style={styles.detailItem}>
                <Ionicons name="resize-outline" size={16} color={C.textLight} />
                <Text style={styles.detailText}>{profile.height} cm</Text>
              </View>
            ) : null}
            {profile.bodyStructure ? (
              <View style={styles.detailItem}>
                <Ionicons name="body-outline" size={16} color={C.textLight} />
                <Text style={styles.detailText}>{profile.bodyStructure}</Text>
              </View>
            ) : null}
            {profile.hairColor ? (
              <View style={styles.detailItem}>
                <Ionicons name="color-palette-outline" size={16} color={C.textLight} />
                <Text style={styles.detailText}>{profile.hairColor} hair</Text>
              </View>
            ) : null}
            {profile.eyeColor ? (
              <View style={styles.detailItem}>
                <Ionicons name="eye-outline" size={16} color={C.textLight} />
                <Text style={styles.detailText}>{profile.eyeColor} eyes</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Desire categories */}
        {profile.desireCategories && profile.desireCategories.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Vibe</Text>
            <View style={styles.chipRow}>
              {profile.desireCategories.map((cat, i) => (
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

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { useDemoStore } from '@/stores/demoStore';
import { useDemoDmStore } from '@/stores/demoDmStore';
import { useAuthStore } from '@/stores/authStore';
import { useConfessionStore } from '@/stores/confessionStore';
import {
  generateRandomProfile,
  generateMatch,
  generateLike,
  generateSuperLike,
} from '@/lib/demo/demoHelpers';
import type { Confession } from '@/types';

export default function DemoPanelScreen() {
  const router = useRouter();

  const profiles = useDemoStore((s) => s.profiles);
  const matches = useDemoStore((s) => s.matches);
  const likes = useDemoStore((s) => s.likes);
  const seed = useDemoStore((s) => s.seed);
  const reset = useDemoStore((s) => s.reset);
  const addProfile = useDemoStore((s) => s.addProfile);
  const clearProfiles = useDemoStore((s) => s.clearProfiles);
  const addMatch = useDemoStore((s) => s.addMatch);
  const addLike = useDemoStore((s) => s.addLike);
  const simulateMatch = useDemoStore((s) => s.simulateMatch);

  const confessions = useConfessionStore((s) => s.confessions);
  const addConfession = useConfessionStore((s) => s.addConfession);

  const blockedUserIds = useDemoStore((s) => s.blockedUserIds);
  const reportedUserIds = useDemoStore((s) => s.reportedUserIds);
  const clearSafety = useDemoStore((s) => s.clearSafety);

  // Ensure seeded on open
  React.useEffect(() => { seed(); }, [seed]);

  // ── Action handlers ──

  const handleAddProfile = () => {
    const p = generateRandomProfile();
    addProfile(p);
    Alert.alert('Added', `${p.name}, ${p.age} from ${p.city}`);
  };

  const handleClearProfiles = () => {
    clearProfiles();
    Alert.alert('Cleared', 'All profiles removed from discover stack');
  };

  const handleSimulateMatch = () => {
    if (profiles.length === 0) {
      Alert.alert('No profiles', 'Add profiles first');
      return;
    }
    const target = profiles[0];
    simulateMatch(target._id);
    Alert.alert('Match!', `You matched with ${target.name}`);
  };

  const handleAddRandomMatch = () => {
    const p = generateRandomProfile();
    const m = generateMatch(p);
    addMatch(m);
    Alert.alert('Match added', `${p.name} added to your matches`);
  };

  const handleAddLike = () => {
    const p = generateRandomProfile();
    const l = generateLike(p);
    addLike(l);
    Alert.alert('Like added', `${p.name} liked you`);
  };

  const handleAddSuperLike = () => {
    const p = generateRandomProfile();
    const sl = generateSuperLike(p);
    addLike(sl);
    Alert.alert('Super Like added', `${p.name} super liked you`);
  };

  const handleSeedConversation = () => {
    if (matches.length === 0) {
      Alert.alert('No matches', 'Add a match first');
      return;
    }
    const match = matches[0];
    const convoId = match.conversationId || match.id;
    const dmStore = useDemoDmStore.getState();
    dmStore.seedConversation(convoId, [
      { _id: `seed_${Date.now()}_1`, content: 'Hey! Great to match with you.', type: 'text', senderId: match.otherUser.id, createdAt: Date.now() - 60000 },
      { _id: `seed_${Date.now()}_2`, content: 'Hi! Thanks, you seem really cool!', type: 'text', senderId: 'demo_user_1', createdAt: Date.now() - 30000 },
      { _id: `seed_${Date.now()}_3`, content: 'What do you like to do for fun?', type: 'text', senderId: match.otherUser.id, createdAt: Date.now() },
    ]);
    Alert.alert('Conversation seeded', `Messages added to chat with ${match.otherUser.name}`);
  };

  const handleResetChats = () => {
    useDemoDmStore.setState({ conversations: {}, meta: {}, drafts: {} });
    Alert.alert('Done', 'All demo chat threads have been cleared');
  };

  const handleAddConfession = () => {
    const texts = [
      'I still think about the one who got away every single day.',
      'I pretend to be busy so I don\'t have to go on dates.',
      'I matched with my best friend\'s ex and we\'re talking.',
      'I\'ve been swiping right on everyone just to boost my ego.',
      'I wrote a love letter but never sent it. It\'s still in my drawer.',
    ];
    const text = texts[Math.floor(Math.random() * texts.length)];
    const moods = ['romantic', 'spicy', 'emotional', 'funny'] as const;
    const confession: Confession = {
      id: `conf_demo_${Date.now()}`,
      userId: `anon_${Date.now()}`,
      text,
      isAnonymous: true,
      mood: moods[Math.floor(Math.random() * moods.length)],
      reactionCount: 0,
      replyCount: 0,
      topEmojis: [],
      createdAt: Date.now(),
      revealPolicy: 'never',
      visibility: 'global',
    };
    addConfession(confession);
    Alert.alert('Confession added', 'Check the Confessions tab');
  };

  const handleResetConfessions = () => {
    useConfessionStore.setState({ seeded: false });
    useConfessionStore.getState().seedConfessions();
    Alert.alert('Reset', 'Confessions restored to defaults');
  };

  const handleClearSafety = () => {
    clearSafety();
    Alert.alert('Cleared', 'All blocked/reported users have been unblocked');
  };

  const handleResetAll = () => {
    Alert.alert('Reset All Demo Data?', 'This will restore everything to defaults and return to profile creation.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => {
          reset();
          useAuthStore.getState().logout();
          router.replace('/' as any);
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Demo Test Panel</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Status Dashboard */}
      <View style={styles.dashboard}>
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{profiles.length}</Text>
          <Text style={styles.statLabel}>Profiles</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{matches.length}</Text>
          <Text style={styles.statLabel}>Matches</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{likes.length}</Text>
          <Text style={styles.statLabel}>Likes</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{confessions.length}</Text>
          <Text style={styles.statLabel}>Confessions</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statNumber, blockedUserIds.length > 0 && { color: COLORS.error }]}>{blockedUserIds.length}</Text>
          <Text style={styles.statLabel}>Blocked</Text>
        </View>
      </View>

      {/* Profiles Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Profiles</Text>
        <View style={styles.buttonRow}>
          <ActionButton label="Add Random Profile" icon="person-add" onPress={handleAddProfile} />
          <ActionButton label="Clear All Profiles" icon="trash" onPress={handleClearProfiles} color={COLORS.error} />
        </View>
      </View>

      {/* Matches Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Matches</Text>
        <View style={styles.buttonRow}>
          <ActionButton label="Simulate Match (next)" icon="heart" onPress={handleSimulateMatch} color={COLORS.primary} />
          <ActionButton label="Add Random Match" icon="people" onPress={handleAddRandomMatch} />
        </View>
      </View>

      {/* Likes Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Likes</Text>
        <View style={styles.buttonRow}>
          <ActionButton label="Add Like" icon="heart-outline" onPress={handleAddLike} />
          <ActionButton label="Add Super Like" icon="star" onPress={handleAddSuperLike} color={COLORS.superLike} />
        </View>
      </View>

      {/* Messages Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Messages</Text>
        <View style={styles.buttonRow}>
          <ActionButton label="Seed Demo Conversation" icon="chatbubbles" onPress={handleSeedConversation} />
          <ActionButton label="Reset Demo Chats" icon="trash" onPress={handleResetChats} color={COLORS.error} />
        </View>
      </View>

      {/* Confessions Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Confessions</Text>
        <View style={styles.buttonRow}>
          <ActionButton label="Add Random Confession" icon="megaphone" onPress={handleAddConfession} />
          <ActionButton label="Reset Confessions" icon="refresh" onPress={handleResetConfessions} color={COLORS.warning} />
        </View>
      </View>

      {/* Safety Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Safety</Text>
        <Text style={styles.safetyInfo}>
          {blockedUserIds.length} blocked, {reportedUserIds.length} reported
        </Text>
        <View style={styles.buttonRow}>
          <ActionButton label="Clear Blocked/Reported" icon="shield-checkmark" onPress={handleClearSafety} color={COLORS.success} />
        </View>
      </View>

      {/* Global Section */}
      <View style={[styles.section, { marginBottom: 60 }]}>
        <Text style={styles.sectionTitle}>Global</Text>
        <View style={styles.buttonRow}>
          <ActionButton label="Reset All Demo Data" icon="nuclear" onPress={handleResetAll} color={COLORS.error} />
        </View>
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Reusable button component
// ---------------------------------------------------------------------------

function ActionButton({
  label,
  icon,
  onPress,
  color,
}: {
  label: string;
  icon: string;
  onPress: () => void;
  color?: string;
}) {
  const tint = color || COLORS.text;
  return (
    <TouchableOpacity style={styles.actionButton} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon as any} size={18} color={tint} style={{ marginRight: 8 }} />
      <Text style={[styles.actionLabel, { color: tint }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

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
  dashboard: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
    paddingHorizontal: 12,
    backgroundColor: COLORS.backgroundDark,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
  },
  stat: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.primary,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  section: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  safetyInfo: {
    fontSize: 13,
    color: COLORS.textLight,
    marginBottom: 10,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
});

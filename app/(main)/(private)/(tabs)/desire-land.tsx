import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DiscoverCardStack } from "@/components/screens/DiscoverCardStack";
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useScreenTrace } from "@/lib/devTrace";

const C = INCOGNITO_COLORS;

export default function DesireLandScreen() {
  useScreenTrace("P2_DESIRE_LAND");
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={[styles.headerShell, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerTopRow}>
          <View>
            <Text style={styles.eyebrow}>PRIVATE MODE</Text>
            <Text style={styles.title}>Deep Connect</Text>
            <Text style={styles.subtitle}>
              Slower pace, stronger intent, and more control over what gets revealed.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.playButton}
            onPress={() => router.push('/(main)/(private)/(tabs)/truth-or-dare' as any)}
            activeOpacity={0.85}
          >
            <Ionicons name="flame" size={16} color={C.background} />
            <Text style={styles.playButtonText}>Truth or Dare</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Ionicons name="compass-outline" size={13} color={C.primary} />
            <Text style={styles.badgeText}>Intent first</Text>
          </View>
          <View style={styles.badge}>
            <Ionicons name="lock-closed-outline" size={13} color={C.primary} />
            <Text style={styles.badgeText}>Mutual reveal</Text>
          </View>
          <View style={styles.badge}>
            <Ionicons name="chatbubble-ellipses-outline" size={13} color={C.primary} />
            <Text style={styles.badgeText}>Deeper chats</Text>
          </View>
        </View>

        <Text style={styles.helperText}>
          Match here through desire and boundaries. Break the ice faster in Truth or Dare.
        </Text>
      </View>

      <View style={styles.stackArea}>
        <DiscoverCardStack theme="dark" mode="phase2" hideHeader />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  headerShell: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: C.background,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: C.primary,
    marginBottom: 6,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: C.text,
  },
  subtitle: {
    marginTop: 6,
    maxWidth: 250,
    fontSize: 14,
    lineHeight: 20,
    color: C.textLight,
  },
  playButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: C.primary,
  },
  playButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: C.background,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.accent,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: C.text,
  },
  helperText: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
    color: C.textLight,
  },
  stackArea: {
    flex: 1,
  },
});

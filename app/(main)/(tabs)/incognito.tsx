import { useState } from 'react';
import { View, Text, StyleSheet, Switch, Alert } from 'react-native';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';

export default function IncognitoScreen() {
  const { userId } = useAuthStore();
  const [localValue, setLocalValue] = useState<boolean | null>(null);

  const profile = useQuery(
    api.users.getCurrentUser,
    userId ? { userId: userId as any } : 'skip'
  );

  const toggleIncognito = useMutation(api.users.toggleIncognito);

  const loading = !profile && !!userId;
  const incognitoEnabled =
    localValue ?? (profile ? profile.incognitoMode : false);

  const canUseIncognito =
    profile &&
    (profile.gender === 'female' || profile.subscriptionTier === 'premium');

  const handleToggle = async (value: boolean) => {
    if (!userId) {
      Alert.alert('Login required', 'Log in to use incognito mode.');
      return;
    }

    if (!canUseIncognito && value) {
      Alert.alert(
        'Upgrade required',
        'Upgrade to Premium (or create a female profile) to use full incognito mode.'
      );
      return;
    }

    setLocalValue(value);
    try {
      await toggleIncognito({
        userId: userId as any,
        enabled: value,
      });
    } catch (e: any) {
      setLocalValue(!value);
      Alert.alert('Error', e.message ?? 'Failed to update incognito mode.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Incognito Mode</Text>
      <Text style={styles.subtitle}>
        Browse profiles without appearing in other people&apos;s feeds. Matches
        and existing conversations are not affected.
      </Text>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Incognito mode</Text>
          <Text style={styles.rowSubtitle}>
            {canUseIncognito
              ? 'You have full access to incognito mode.'
              : 'Limited access. Upgrade to Premium for full incognito.'}
          </Text>
        </View>
        <Switch
          value={incognitoEnabled}
          onValueChange={handleToggle}
          disabled={loading}
          trackColor={{ false: COLORS.border, true: COLORS.primary }}
          thumbColor={COLORS.white}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: COLORS.background,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 32,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  rowText: {
    flex: 1,
    paddingRight: 16,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  rowSubtitle: {
    fontSize: 13,
    color: COLORS.textLight,
  },
});


import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Switch,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, SORT_OPTIONS, GENDER_OPTIONS } from '@/lib/constants';
import { Button, Input } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { useFilterStore } from '@/stores/filterStore';

export default function SettingsScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();

  const currentUser = useQuery(
    api.users.getCurrentUser,
    userId ? { userId: userId as any } : 'skip'
  );

  const updatePreferences = useMutation(api.users.updatePreferences);
  const toggleIncognito = useMutation(api.users.toggleIncognito);

  const {
    minAge,
    maxAge,
    maxDistance,
    lookingFor,
    setMinAge,
    setMaxAge,
    setMaxDistance,
    toggleGender,
  } = useFilterStore();

  const [localMinAge, setLocalMinAge] = useState(minAge.toString());
  const [localMaxAge, setLocalMaxAge] = useState(maxAge.toString());
  const [localMaxDistance, setLocalMaxDistance] = useState(maxDistance.toString());
  const [incognitoEnabled, setIncognitoEnabled] = useState(currentUser?.incognitoMode || false);

  React.useEffect(() => {
    if (currentUser) {
      setLocalMinAge(currentUser.minAge.toString());
      setLocalMaxAge(currentUser.maxAge.toString());
      setLocalMaxDistance(currentUser.maxDistance.toString());
      setIncognitoEnabled(currentUser.incognitoMode || false);
    }
  }, [currentUser]);

  const handleSavePreferences = async () => {
    if (!userId) return;

    try {
      await updatePreferences({
        userId: userId as any,
        minAge: parseInt(localMinAge),
        maxAge: parseInt(localMaxAge),
        maxDistance: parseInt(localMaxDistance),
        lookingFor: lookingFor.length > 0 ? lookingFor : undefined,
      });
      setMinAge(parseInt(localMinAge));
      setMaxAge(parseInt(localMaxAge));
      setMaxDistance(parseInt(localMaxDistance));
      Alert.alert('Success', 'Preferences updated!');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update preferences');
    }
  };

  const handleToggleIncognito = async (enabled: boolean) => {
    if (!userId) return;

    try {
      await toggleIncognito({ userId: userId as any, enabled });
      setIncognitoEnabled(enabled);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to toggle incognito mode');
      setIncognitoEnabled(!enabled);
    }
  };

  if (!currentUser) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const canUseIncognito =
    currentUser.gender === 'female' || currentUser.subscriptionTier === 'premium';

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Discovery Preferences</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Looking for</Text>
          <View style={styles.chips}>
            {GENDER_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.chip,
                  lookingFor.includes(option.value) && styles.chipSelected,
                ]}
                onPress={() => toggleGender(option.value)}
              >
                <Text
                  style={[
                    styles.chipText,
                    lookingFor.includes(option.value) && styles.chipTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Age Range</Text>
          <View style={styles.ageRow}>
            <Input
              placeholder="Min"
              value={localMinAge}
              onChangeText={setLocalMinAge}
              keyboardType="numeric"
              style={styles.ageInput}
            />
            <Text style={styles.ageSeparator}>to</Text>
            <Input
              placeholder="Max"
              value={localMaxAge}
              onChangeText={setLocalMaxAge}
              keyboardType="numeric"
              style={styles.ageInput}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Maximum Distance (miles)</Text>
          <Input
            placeholder="Distance"
            value={localMaxDistance}
            onChangeText={setLocalMaxDistance}
            keyboardType="numeric"
            style={styles.distanceInput}
          />
        </View>

        <Button
          title="Save Preferences"
          variant="primary"
          onPress={handleSavePreferences}
          style={styles.saveButton}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Privacy</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>Incognito Mode</Text>
            <Text style={styles.settingDescription}>
              Browse profiles without being seen
              {!canUseIncognito && ' (Premium required)'}
            </Text>
          </View>
          <Switch
            value={incognitoEnabled}
            onValueChange={handleToggleIncognito}
            disabled={!canUseIncognito}
            trackColor={{ false: COLORS.border, true: COLORS.primary }}
            thumbColor={COLORS.white}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <Text style={styles.sectionSubtitle}>
          Manage your notification preferences
        </Text>
        <TouchableOpacity style={styles.menuItem}>
          <Text style={styles.menuText}>Push Notifications</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem}>
          <Text style={styles.menuText}>Email Notifications</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/(main)/edit-profile')}
        >
          <Text style={styles.menuText}>Edit Profile</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem}>
          <Text style={styles.menuText}>Privacy Policy</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem}>
          <Text style={styles.menuText}>Terms of Service</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem}>
          <Text style={styles.menuText}>Help & Support</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.textLight,
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
  section: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: 14,
    color: COLORS.text,
  },
  chipTextSelected: {
    color: COLORS.white,
    fontWeight: '600',
  },
  ageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ageInput: {
    flex: 1,
  },
  ageSeparator: {
    fontSize: 16,
    color: COLORS.textLight,
  },
  distanceInput: {
    width: 150,
  },
  saveButton: {
    marginTop: 8,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 12,
    color: COLORS.textLight,
    lineHeight: 16,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  menuText: {
    fontSize: 16,
    color: COLORS.text,
  },
});

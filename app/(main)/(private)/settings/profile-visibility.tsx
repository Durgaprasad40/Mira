/**
 * Phase-2 Profile Visibility Settings Screen
 *
 * Allows users to pause/unpause their profile from Desire Land discovery.
 * When paused, the profile is hidden from discovery but existing chats remain.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';

const C = INCOGNITO_COLORS;

export default function ProfileVisibilityScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { userId } = useAuthStore();
  const isPrivateEnabled = usePrivateProfileStore((s) => s.isPrivateEnabled);
  const setIsPrivateEnabled = usePrivateProfileStore((s) => s.setIsPrivateEnabled);

  const updateProfile = useMutation(api.privateProfiles.updateFieldsByAuthId);

  const [isSaving, setIsSaving] = useState(false);

  // isPaused is inverse of isPrivateEnabled for clearer UX
  // isPrivateEnabled=true means visible (not paused)
  // isPrivateEnabled=false means hidden (paused)
  const isPaused = !isPrivateEnabled;

  const handleToggle = async (newPausedState: boolean) => {
    if (isSaving) return;

    const newEnabledState = !newPausedState; // Inverse

    setIsSaving(true);
    try {
      // Update local store immediately for responsive UI
      setIsPrivateEnabled(newEnabledState);

      // Sync to backend
      if (!isDemoMode && userId) {
        const result = await updateProfile({
          authUserId: userId,
          isPrivateEnabled: newEnabledState,
        });

        if (!result.success) {
          // Rollback on failure
          setIsPrivateEnabled(!newEnabledState);
          Alert.alert('Error', 'Failed to update profile visibility. Please try again.');
          return;
        }

        if (__DEV__) {
          console.log('[ProfileVisibility] Backend sync success:', {
            isPrivateEnabled: newEnabledState,
          });
        }
      }
    } catch (error) {
      // Rollback on error
      setIsPrivateEnabled(!newEnabledState);
      if (__DEV__) {
        console.error('[ProfileVisibility] Save error:', error);
      }
      Alert.alert('Error', 'Failed to update profile visibility. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile Visibility</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Status Card */}
        <View style={[styles.statusCard, isPaused && styles.statusCardPaused]}>
          <Ionicons
            name={isPaused ? 'pause-circle' : 'checkmark-circle'}
            size={32}
            color={isPaused ? '#F59E0B' : '#10B981'}
          />
          <View style={styles.statusTextContainer}>
            <Text style={[styles.statusTitle, isPaused && styles.statusTitlePaused]}>
              {isPaused ? 'Profile Paused' : 'Profile Active'}
            </Text>
            <Text style={styles.statusDescription}>
              {isPaused
                ? 'Your profile is hidden from Desire Land'
                : 'Others can find you in Desire Land'}
            </Text>
          </View>
        </View>

        {/* Toggle Section */}
        <View style={styles.section}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Pause Profile</Text>
              <Text style={styles.toggleDescription}>
                Hide your profile from Desire Land without deleting your account.
              </Text>
            </View>
            {isSaving ? (
              <ActivityIndicator size="small" color={C.primary} />
            ) : (
              <Switch
                value={isPaused}
                onValueChange={handleToggle}
                trackColor={{ false: C.border, true: '#F59E0B' }}
                thumbColor="#FFF"
              />
            )}
          </View>
        </View>

        {/* Info Section */}
        <View style={styles.infoSection}>
          <View style={styles.infoRow}>
            <Ionicons name="chatbubbles-outline" size={20} color={C.textLight} />
            <Text style={styles.infoText}>
              Your existing chats and connections will remain accessible
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="eye-off-outline" size={20} color={C.textLight} />
            <Text style={styles.infoText}>
              You won't appear in others' Desire Land feed while paused
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="refresh-outline" size={20} color={C.textLight} />
            <Text style={styles.infoText}>
              You can unpause anytime to become visible again
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: C.text,
  },
  content: {
    flex: 1,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    margin: 16,
    padding: 16,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  statusCardPaused: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  statusTextContainer: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#10B981',
    marginBottom: 2,
  },
  statusTitlePaused: {
    color: '#F59E0B',
  },
  statusDescription: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleInfo: {
    flex: 1,
    marginRight: 16,
  },
  toggleTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: C.text,
    marginBottom: 4,
  },
  toggleDescription: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
  },
  infoSection: {
    padding: 16,
    gap: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: C.textLight,
    lineHeight: 20,
  },
});

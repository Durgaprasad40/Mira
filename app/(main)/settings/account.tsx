/*
 * LOCKED (ACCOUNT SETTINGS)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { useDemoStore } from '@/stores/demoStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { isDemoMode } from '@/hooks/useConvex';
import { safeReplace } from '@/lib/safeRouter';
import { getDemoCurrentUser } from '@/lib/demoData';

export default function AccountSettingsScreen() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.userId);
  const softDeleteMutation = useMutation(api.auth.softDeleteAccount);
  const deactivateMutation = useMutation(api.users.deactivateAccount);

  // Query current user for email display (live mode only)
  const currentUserQuery = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId } : 'skip'
  );
  const currentUser = isDemoMode ? (getDemoCurrentUser() as any) : currentUserQuery;
  const [timedOut, setTimedOut] = useState(false);

  // Safe back navigation - ensures return to Profile tab
  const handleGoBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(main)/(tabs)/profile' as any);
    }
  }, [router]);

  useEffect(() => {
    if (isDemoMode || currentUserQuery !== undefined || !token) return;

    const timeout = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(timeout);
  }, [currentUserQuery, token]);

  const isLoading = !isDemoMode && !!token && currentUserQuery === undefined && !timedOut;
  const isUnavailable =
    !isDemoMode && (!token || currentUserQuery === null || (currentUserQuery === undefined && timedOut));

  // Delete confirmation modal state (Step 1: info modal)
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const handleDeactivatePress = () => {
    Alert.alert(
      'Deactivate Mira account?',
      'Your Mira account, including Phase-1 and Phase-2, will be hidden until you sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate Mira account',
          style: 'destructive',
          onPress: async () => {
            try {
              if (isDemoMode) {
                useDemoStore.getState().demoLogout();
                useOnboardingStore.getState().reset();
                await logout();
                safeReplace(router, '/(auth)/welcome', 'account->deactivate');
                return;
              }

              if (!userId || !token) {
                Alert.alert('Error', 'Unable to deactivate your account. Please try again.');
                return;
              }

              await deactivateMutation({ token, authUserId: userId });

              useOnboardingStore.getState().reset();
              await logout();
              safeReplace(router, '/(auth)/welcome', 'account->deactivate');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to deactivate account. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleDeletePress = () => {
    setShowDeleteModal(true);
  };

  // Step 1: User taps "Continue" on info modal → show final confirmation alert
  const handleDeleteContinue = () => {
    setShowDeleteModal(false);

    // Step 2: Final confirmation alert
    Alert.alert(
      'Delete Mira account?',
      'Your Mira account, including Phase-1 and Phase-2, will be scheduled for deletion. You can restore it by signing in again within 30 days. After that, it may be permanently deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Mira account',
          style: 'destructive',
          onPress: async () => {
            try {
              if (isDemoMode) {
                useDemoStore.getState().demoLogout();
                useOnboardingStore.getState().reset();
                await logout();
                safeReplace(router, '/(auth)/welcome', 'account->delete');
                return;
              }

              // Real mode: call soft delete mutation before logging out
              if (!userId || !token) {
                Alert.alert('Error', 'Unable to delete your account. Please log out and back in, then try again.');
                return;
              }

              await softDeleteMutation({
                token,
                authUserId: userId,
                reason: 'User requested account deletion',
              });

              // Clear local state and log out (matches existing logout routing behavior)
              useOnboardingStore.getState().reset();
              await logout();
              safeReplace(router, '/(auth)/welcome', 'account->delete');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete account. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleDeleteCancel = () => {
    setShowDeleteModal(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleGoBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Account</Text>
        <View style={{ width: 24 }} />
      </View>

      {isLoading ? (
        <View style={styles.stateContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.stateText}>Loading your account details...</Text>
        </View>
      ) : isUnavailable ? (
        <View style={styles.stateContainer}>
          <Ionicons name="person-circle-outline" size={40} color={COLORS.textMuted} />
          <Text style={styles.stateText}>We couldn&apos;t load your account details.</Text>
          <TouchableOpacity style={styles.stateButton} onPress={handleGoBack} accessibilityLabel="Back to profile">
            <Text style={styles.stateButtonText}>Back to Profile</Text>
          </TouchableOpacity>
        </View>
      ) : (
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Account Info Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Info</Text>

          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Ionicons name="mail-outline" size={22} color={COLORS.text} />
              <View style={styles.infoRowContent}>
                <Text style={styles.infoRowLabel}>Email</Text>
                <Text style={styles.infoRowValue}>{currentUser?.email || 'Not set'}</Text>
              </View>
            </View>
          </View>

          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Ionicons name="call-outline" size={22} color={COLORS.text} />
              <View style={styles.infoRowContent}>
                <Text style={styles.infoRowLabel}>Phone</Text>
                <Text style={styles.infoRowValue}>{currentUser?.phone || 'Not set'}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Danger Zone Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: COLORS.error }]}>Danger Zone</Text>

          <View style={styles.dangerCard}>
            <View style={styles.dangerCardHeader}>
              <Ionicons name="warning-outline" size={20} color={COLORS.error} />
              <Text style={styles.dangerCardTitle}>Deactivate Mira account</Text>
            </View>
            <Text style={styles.dangerCardDescription}>
              This hides your Mira account, including Phase-1 and Phase-2, until you sign in again.
            </Text>
            <TouchableOpacity
              style={styles.dangerButton}
              onPress={handleDeactivatePress}
              activeOpacity={0.8}
              accessibilityLabel="Deactivate Mira account"
              accessibilityHint="Hides your account until you sign in again."
            >
              <Ionicons name="pause-outline" size={18} color={COLORS.white} />
              <Text style={styles.dangerButtonText}>Deactivate Mira account</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.dangerCard, { marginTop: 12 }]}>
            <View style={styles.dangerCardHeader}>
              <Ionicons name="trash-outline" size={20} color={COLORS.error} />
              <Text style={styles.dangerCardTitle}>Delete Mira account</Text>
            </View>
            <Text style={styles.dangerCardDescription}>
              This starts the deletion process for your Mira account. You can restore it by signing in again within 30 days.
            </Text>
            <TouchableOpacity
              style={styles.dangerButton}
              onPress={handleDeletePress}
              activeOpacity={0.8}
              accessibilityLabel="Delete Mira account"
              accessibilityHint="Starts the 30-day deletion window for your account."
            >
              <Ionicons name="trash-outline" size={18} color={COLORS.white} />
              <Text style={styles.dangerButtonText}>Delete Mira account</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
      )}

      {/* Delete Info Modal (Step 1) */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={handleDeleteCancel}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Ionicons name="alert-circle" size={32} color={COLORS.error} />
              <Text style={styles.modalTitle}>Delete Mira account</Text>
            </View>

            <View style={styles.modalInfoList}>
              <Text style={styles.modalInfoItem}>
                • This deletes your full Mira account (Phase-1 and Phase-2).
              </Text>
              <Text style={styles.modalInfoItem}>
                • You can restore it by signing in again within 30 days.
              </Text>
              <Text style={styles.modalInfoItem}>
                • After 30 days, it may be permanently deleted.
              </Text>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={handleDeleteCancel}
                accessibilityLabel="Cancel account deletion"
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalConfirmButton}
                onPress={handleDeleteContinue}
                accessibilityLabel="Continue account deletion"
              >
                <Text style={styles.modalConfirmText}>Continue</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  content: {
    flex: 1,
  },
  stateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  stateText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  stateButton: {
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  stateButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  // Account info rows
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  infoRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  infoRowContent: {
    gap: 2,
  },
  infoRowLabel: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  infoRowValue: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  // Danger zone card
  dangerCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.06)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.15)',
  },
  dangerCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  dangerCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.error,
  },
  dangerCardDescription: {
    fontSize: 14,
    color: COLORS.textMuted,
    lineHeight: 20,
    marginBottom: 14,
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.error,
    paddingVertical: 12,
    borderRadius: 10,
  },
  dangerButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContainer: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 12,
  },
  modalInfoList: {
    marginBottom: 24,
  },
  modalInfoItem: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 22,
    marginBottom: 4,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  modalConfirmButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: COLORS.error,
    alignItems: 'center',
  },
  modalConfirmText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
  },
});

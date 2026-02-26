import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { useDemoStore } from '@/stores/demoStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { isDemoMode } from '@/hooks/useConvex';
import { safeReplace } from '@/lib/safeRouter';

export default function AccountSettingsScreen() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);

  // Delete confirmation modal state (Step 1: info modal)
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const handleLogout = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: () => {
            if (isDemoMode) {
              useDemoStore.getState().demoLogout();
            }
            useOnboardingStore.getState().reset();
            logout();
            safeReplace(router, '/(auth)/welcome', 'account->logout');
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
      'Are you sure?',
      'This will schedule your account for deletion.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // Log out immediately (UI only - actual deletion not implemented)
            if (isDemoMode) {
              useDemoStore.getState().demoLogout();
            }
            useOnboardingStore.getState().reset();
            logout();
            safeReplace(router, '/(auth)/welcome', 'account->delete');
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
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Account</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Account Info Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Info</Text>

          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Ionicons name="mail-outline" size={22} color={COLORS.text} />
              <View style={styles.infoRowContent}>
                <Text style={styles.infoRowLabel}>Email</Text>
                <Text style={styles.infoRowValue}>demo@mira.app</Text>
              </View>
            </View>
          </View>

          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Ionicons name="call-outline" size={22} color={COLORS.text} />
              <View style={styles.infoRowContent}>
                <Text style={styles.infoRowLabel}>Phone</Text>
                <Text style={styles.infoRowValue}>Not set</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Session Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Session</Text>

          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.8}>
            <Ionicons name="log-out-outline" size={20} color={COLORS.primary} />
            <Text style={styles.logoutButtonText}>Log Out</Text>
          </TouchableOpacity>
        </View>

        {/* Danger Zone Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: COLORS.error }]}>Danger Zone</Text>

          <View style={styles.dangerCard}>
            <View style={styles.dangerCardHeader}>
              <Ionicons name="warning-outline" size={20} color={COLORS.error} />
              <Text style={styles.dangerCardTitle}>Delete Account</Text>
            </View>
            <Text style={styles.dangerCardDescription}>
              Your account will be scheduled for deletion.{'\n'}
              You can recover it within 30 days.{'\n'}
              After 30 days, all data will be permanently deleted.
            </Text>
            <TouchableOpacity style={styles.dangerButton} onPress={handleDeletePress} activeOpacity={0.8}>
              <Ionicons name="trash-outline" size={18} color={COLORS.white} />
              <Text style={styles.dangerButtonText}>Delete My Account</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

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
              <Text style={styles.modalTitle}>Delete Account</Text>
            </View>

            <View style={styles.modalInfoList}>
              <Text style={styles.modalInfoItem}>
                • Your account will be scheduled for deletion.
              </Text>
              <Text style={styles.modalInfoItem}>
                • You can recover it within 30 days.
              </Text>
              <Text style={styles.modalInfoItem}>
                • After 30 days, all data will be permanently deleted.
              </Text>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={handleDeleteCancel}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalConfirmButton}
                onPress={handleDeleteContinue}
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
  // Logout button
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: 'transparent',
  },
  logoutButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
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

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
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS, COLORS } from '@/lib/constants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';

const C = INCOGNITO_COLORS;

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { userId } = useAuthStore();
  const initiatePrivateDataDeletion = usePrivateProfileStore((s) => s.initiatePrivateDataDeletion);
  const recoverPrivateData = usePrivateProfileStore((s) => s.recoverPrivateData);

  const initiateDeletionMutation = useMutation(api.privateDeletion.initiatePrivateDeletion);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeletePress = () => {
    setShowDeleteModal(true);
  };

  const handleDeleteContinue = async () => {
    setShowDeleteModal(false);

    Alert.alert(
      'Final Confirmation',
      'Your Deep Connect data will be hidden immediately and permanently deleted in 30 days. You can recover it during this period.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: async () => {
            // Prevent duplicate calls (double-tap guard)
            if (isDeleting) return;

            try {
              setIsDeleting(true);

              // CRITICAL: Verify userId exists before proceeding (non-demo mode)
              if (!isDemoMode && !userId) {
                Alert.alert('Error', 'You must be logged in to deactivate Deep Connect.');
                return;
              }

              // Update local store immediately for UI responsiveness (optimistic)
              initiatePrivateDataDeletion();

              // M-004 FIX: Server mutation with rollback on failure
              if (!isDemoMode && userId) {
                try {
                  await initiateDeletionMutation({});
                } catch (serverError) {
                  // M-004 FIX: Rollback optimistic update to keep local+server consistent
                  recoverPrivateData();
                  throw serverError; // Re-throw to outer catch for error alert
                }
              }

              Alert.alert(
                'Deep Connect Deactivated',
                'Your private profile is now hidden. You have 30 days to recover your data.',
                [
                  {
                    text: 'OK',
                    onPress: () => {
                      // Route to Phase-1 home tab (not Phase-2)
                      router.replace('/(main)/(tabs)/home' as any);
                    },
                  },
                ]
              );
            } catch (error) {
              console.error('Error deactivating Deep Connect:', error);
              Alert.alert('Error', 'Failed to deactivate Deep Connect. Please try again.');
            } finally {
              setIsDeleting(false);
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
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Account</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Danger Zone Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: COLORS.error }]}>Danger Zone</Text>

          <View style={styles.dangerCard}>
            <View style={styles.dangerCardHeader}>
              <Ionicons name="eye-off-outline" size={20} color={COLORS.error} />
              <Text style={styles.dangerCardTitle}>Deactivate Deep Connect</Text>
            </View>
            <Text style={styles.dangerCardDescription}>
              Your private profile and Deep Connect data will be hidden. You can recover them within 30 days.{'\n'}
              {'\n'}
              After 30 days, all data will be permanently deleted.
            </Text>
            <TouchableOpacity
              style={styles.dangerButton}
              onPress={handleDeletePress}
              activeOpacity={0.8}
            >
              <Ionicons name="eye-off-outline" size={18} color="#FFF" />
              <Text style={styles.dangerButtonText}>Deactivate Deep Connect</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Delete Confirmation Modal with Anti-Scam Warning */}
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
              <Text style={styles.modalTitle}>Deactivate Deep Connect</Text>
            </View>

            {/* Anti-Scam Warning */}
            <View style={styles.warningBox}>
              <Ionicons name="shield-checkmark-outline" size={20} color="#F59E0B" />
              <Text style={styles.warningText}>
                If someone is asking you to deactivate Deep Connect, you may be getting scammed. Only proceed if YOU want to deactivate.
              </Text>
            </View>

            <View style={styles.modalInfoList}>
              <Text style={styles.modalInfoItem}>
                • Your private profile will be hidden immediately
              </Text>
              <Text style={styles.modalInfoItem}>
                • You have 30 days to recover your data
              </Text>
              <Text style={styles.modalInfoItem}>
                • After 30 days, all Deep Connect data will be permanently deleted
              </Text>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={handleDeleteCancel}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalDeleteButton}
                onPress={handleDeleteContinue}
              >
                <Text style={styles.modalDeleteText}>Continue</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  section: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
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
    color: C.textLight,
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
    color: '#FFF',
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
    backgroundColor: C.background,
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
    color: C.text,
    marginTop: 12,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: C.text,
    lineHeight: 18,
  },
  modalInfoList: {
    marginBottom: 24,
  },
  modalInfoItem: {
    fontSize: 14,
    color: C.text,
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
    backgroundColor: C.surface,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
  },
  modalDeleteButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: COLORS.error,
    alignItems: 'center',
  },
  modalDeleteText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },
});

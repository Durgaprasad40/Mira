import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Modal, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { useIncognitoStore } from '@/stores/incognitoStore';
import { isDemoMode } from '@/hooks/useConvex';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES, PRIVATE_DESIRE_TAGS, PRIVATE_BOUNDARIES } from '@/lib/privateConstants';

const C = INCOGNITO_COLORS;

export default function ActivateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();

  const store = usePrivateProfileStore();
  const ageConfirmedAt = useIncognitoStore((s) => s.ageConfirmedAt);

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [activating, setActivating] = useState(false);

  const upsertProfile = useMutation(api.privateProfiles.upsert);

  // Fetch user info for auto-import
  const currentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  useEffect(() => {
    store.setCurrentStep(4);

    // Auto-import user info
    if (currentUser) {
      const birthDate = new Date(currentUser.dateOfBirth);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }

      store.setProfileInfo({
        displayName: currentUser.name,
        age,
        city: currentUser.city ?? '',
        gender: currentUser.gender,
      });
    }
  }, [currentUser]);

  const handleActivate = async () => {
    setShowConfirmModal(false);
    setActivating(true);

    try {
      if (isDemoMode) {
        // Demo mode — just mark as complete
        store.setIsSetupComplete(true);
        store.setConvexProfileId('demo_profile');
        router.replace('/(main)/(tabs)/incognito' as any);
        return;
      }

      if (!userId) throw new Error('Not authenticated');

      const result = await upsertProfile({
        userId: userId as any,
        isPrivateEnabled: true,
        ageConfirmed18Plus: true,
        ageConfirmedAt: ageConfirmedAt ?? Date.now(),
        privatePhotosBlurred: store.blurredStorageIds as any,
        privatePhotoUrls: store.blurredPhotoUrls,
        privatePhotoBlurLevel: 40,
        privateIntentKeys: store.intentKeys,
        privateDesireTagKeys: store.desireTags,
        privateBoundaries: store.boundaries,
        privateBio: store.privateBio || undefined,
        displayName: store.displayName || 'Anonymous',
        age: store.age || 18,
        city: store.city || undefined,
        gender: store.gender || 'other',
        revealPolicy: 'mutual_only',
        isSetupComplete: true,
      });

      store.setIsSetupComplete(true);
      store.setConvexProfileId(result.profileId);

      router.replace('/(main)/(tabs)/incognito' as any);
    } catch (error) {
      Alert.alert('Error', 'Failed to activate private profile. Please try again.');
      console.error('Activation error:', error);
    }
    setActivating(false);
  };

  // Resolve labels from keys
  const intentLabels = store.intentKeys
    .map((k) => PRIVATE_INTENT_CATEGORIES.find((c) => c.key === k)?.label)
    .filter(Boolean);
  const tagLabels = store.desireTags
    .map((k) => PRIVATE_DESIRE_TAGS.find((t) => t.key === k)?.label)
    .filter(Boolean);
  const boundaryLabels = store.boundaries
    .map((k) => PRIVATE_BOUNDARIES.find((b) => b.key === k)?.label)
    .filter(Boolean);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Activate</Text>
        <Text style={styles.stepLabel}>Step 4 of 4</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="shield-checkmark" size={48} color={C.primary} />
        </View>
        <Text style={styles.title}>Ready to go private</Text>
        <Text style={styles.subtitle}>
          Review your setup below, then activate your private profile.
        </Text>

        {/* Summary */}
        <View style={styles.summaryCard}>
          <SummaryRow icon="images" label="Photos" value={`${store.selectedPhotoIds.length} blurred photo(s)`} />
          <SummaryRow icon="compass" label="Intents" value={intentLabels.join(', ')} />
          <SummaryRow icon="pricetags" label="Tags" value={`${tagLabels.length} selected`} />
          <SummaryRow icon="shield" label="Boundaries" value={`${boundaryLabels.length} set`} />
          {store.privateBio ? (
            <SummaryRow icon="chatbubble" label="Bio" value={store.privateBio} />
          ) : null}
          <SummaryRow icon="eye-off" label="Reveal" value="Mutual only" />
        </View>

        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={16} color={C.textLight} />
          <Text style={styles.infoText}>
            Your private profile is completely separate from your main profile.
            Only blurred photos are shown. Original photos are only shared through mutual reveal.
          </Text>
        </View>
      </ScrollView>

      {/* Bottom action */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.activateBtn, activating && styles.activateBtnDisabled]}
          onPress={() => setShowConfirmModal(true)}
          disabled={activating}
        >
          {activating ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="eye-off" size={18} color="#FFFFFF" />
              <Text style={styles.activateBtnText}>Activate Private Profile</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Confirmation modal */}
      <Modal visible={showConfirmModal} transparent animationType="fade" onRequestClose={() => setShowConfirmModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalIconWrap}>
              <Ionicons name="eye-off" size={40} color={C.primary} />
            </View>
            <Text style={styles.modalTitle}>Activate Private Mode?</Text>
            <Text style={styles.modalBody}>
              Your private profile will become visible to other Private Mode users.
              Only blurred photos will be shown.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowConfirmModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={handleActivate}
              >
                <Text style={styles.modalConfirmText}>Activate</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SummaryRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <View style={styles.summaryLeft}>
        <Ionicons name={icon as any} size={16} color={C.primary} />
        <Text style={styles.summaryLabel}>{label}</Text>
      </View>
      <Text style={styles.summaryValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  stepLabel: { fontSize: 12, color: C.textLight },
  content: { padding: 20 },
  iconWrap: { alignItems: 'center', marginBottom: 16, marginTop: 8 },
  title: { fontSize: 22, fontWeight: '700', color: C.text, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 14, color: C.textLight, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  summaryCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.background,
  },
  summaryLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 0.4 },
  summaryLabel: { fontSize: 13, fontWeight: '600', color: C.text },
  summaryValue: { fontSize: 13, color: C.textLight, flex: 0.6, textAlign: 'right' },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: C.surface,
    borderRadius: 10,
    padding: 12,
  },
  infoText: { flex: 1, fontSize: 12, color: C.textLight, lineHeight: 18 },
  bottomBar: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  activateBtn: {
    flexDirection: 'row',
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  activateBtnDisabled: { backgroundColor: C.surface },
  activateBtnText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalSheet: {
    backgroundColor: C.background,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 360,
  },
  modalIconWrap: { alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: C.text, textAlign: 'center', marginBottom: 8 },
  modalBody: { fontSize: 14, color: C.textLight, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  modalActions: { flexDirection: 'row', gap: 12 },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: C.surface,
  },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: C.textLight },
  modalConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: C.primary,
  },
  modalConfirmText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
});

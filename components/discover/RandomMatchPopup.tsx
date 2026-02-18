/**
 * RandomMatchPopup - Shows a "match suggestion" modal
 *
 * F2: Controlled by shouldShowRandomMatchPopup gate:
 * - Only shown after 5 swipes OR 3 profile views
 * - Max 1 per session
 * - 24hr cooldown after showing
 * - +3 day backoff on dismiss
 */
import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Image } from 'react-native';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { trackEvent } from '@/lib/analytics';

export interface RandomMatchProfile {
  id: string;
  name: string;
  age: number;
  photoUrl: string;
  city?: string;
}

interface RandomMatchPopupProps {
  visible: boolean;
  profile: RandomMatchProfile | null;
  onAccept: () => void;
  onDismiss: () => void;
}

export function RandomMatchPopup({ visible, profile, onAccept, onDismiss }: RandomMatchPopupProps) {
  if (!profile) return null;

  const handleAccept = () => {
    trackEvent({ name: 'random_match_popup_accepted', profileId: profile.id });
    onAccept();
  };

  const handleDismiss = () => {
    trackEvent({ name: 'random_match_popup_dismissed', profileId: profile.id });
    onDismiss();
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Close button */}
          <TouchableOpacity style={styles.closeBtn} onPress={handleDismiss}>
            <Ionicons name="close" size={24} color={COLORS.textLight} />
          </TouchableOpacity>

          {/* Header */}
          <View style={styles.sparkleRow}>
            <Ionicons name="sparkles" size={24} color={COLORS.primary} />
            <Text style={styles.title}>Match Suggestion</Text>
          </View>

          {/* Profile preview */}
          <View style={styles.profileSection}>
            <Image source={{ uri: profile.photoUrl }} style={styles.photo} />
            <Text style={styles.name}>{profile.name}, {profile.age}</Text>
            {profile.city && <Text style={styles.city}>{profile.city}</Text>}
          </View>

          <Text style={styles.subtitle}>
            We think you two might hit it off!
          </Text>

          {/* Action buttons */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.dismissBtn} onPress={handleDismiss}>
              <Ionicons name="close" size={22} color={COLORS.textLight} />
              <Text style={styles.dismissText}>Not Now</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept}>
              <Ionicons name="heart" size={22} color={COLORS.white} />
              <Text style={styles.acceptText}>Like</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: COLORS.background,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 1,
    padding: 4,
  },
  sparkleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  profileSection: {
    alignItems: 'center',
    marginBottom: 16,
  },
  photo: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: 12,
    backgroundColor: COLORS.border,
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  city: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 4,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 24,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  dismissBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  dismissText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  acceptBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  acceptText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
  },
});

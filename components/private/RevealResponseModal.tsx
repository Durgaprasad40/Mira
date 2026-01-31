import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

interface RevealResponseModalProps {
  visible: boolean;
  fromDisplayName: string;
  onAccept: () => void;
  onDecline: () => void;
  onClose: () => void;
}

export function RevealResponseModal({
  visible,
  fromDisplayName,
  onAccept,
  onDecline,
  onClose,
}: RevealResponseModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.iconWrap}>
            <Ionicons name="eye" size={40} color={C.primary} />
          </View>

          <Text style={styles.title}>Reveal Request</Text>
          <Text style={styles.body}>
            <Text style={styles.bold}>{fromDisplayName}</Text> wants to reveal photos
            with you. If you both accept, you'll see each other's unblurred photos.
          </Text>

          <View style={styles.infoBox}>
            <Ionicons name="shield-checkmark" size={16} color={C.textLight} />
            <Text style={styles.infoText}>
              This is a mutual action — both parties must accept before any photos are shared.
            </Text>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.declineBtn}
              onPress={onDecline}
              activeOpacity={0.7}
            >
              <Text style={styles.declineText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.acceptBtn}
              onPress={onAccept}
              activeOpacity={0.7}
            >
              <Ionicons name="eye" size={16} color="#FFFFFF" />
              <Text style={styles.acceptText}>Accept Reveal</Text>
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
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: C.background,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 360,
  },
  iconWrap: { alignItems: 'center', marginBottom: 16 },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: C.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  bold: { fontWeight: '700', color: C.text },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: C.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
  },
  infoText: { flex: 1, fontSize: 12, color: C.textLight, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 12 },
  declineBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: C.surface,
  },
  declineText: { fontSize: 14, fontWeight: '600', color: C.textLight },
  acceptBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: C.primary,
  },
  acceptText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
});

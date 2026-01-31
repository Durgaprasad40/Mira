import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const REPORT_REASONS = [
  { id: 'inappropriate', label: 'Inappropriate content' },
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'spam', label: 'Spam or scam' },
  { id: 'fake', label: 'Fake profile' },
  { id: 'underage', label: 'Underage user' },
  { id: 'other', label: 'Other' },
] as const;

interface ReportModalProps {
  visible: boolean;
  targetName: string;
  onClose: () => void;
  onReport: (reason: string) => void;
  onBlock: () => void;
}

export function ReportModal({ visible, targetName, onClose, onReport, onBlock }: ReportModalProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleReport = () => {
    if (!selected) return;
    onReport(selected);
    setSelected(null);
    Alert.alert('Reported', 'Thank you. We will review this shortly.', [{ text: 'OK' }]);
  };

  const handleBlock = () => {
    Alert.alert(
      'Block User',
      `Block ${targetName}? They won't be able to contact you in Private.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => {
            onBlock();
            onClose();
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Report or Block</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={C.text} />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            Why are you reporting {targetName}?
          </Text>

          {REPORT_REASONS.map((reason) => (
            <TouchableOpacity
              key={reason.id}
              style={[styles.reasonRow, selected === reason.id && styles.reasonRowSelected]}
              onPress={() => setSelected(reason.id)}
            >
              <Ionicons
                name={selected === reason.id ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={selected === reason.id ? C.primary : C.textLight}
              />
              <Text style={styles.reasonText}>{reason.label}</Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={[styles.reportButton, !selected && styles.reportButtonDisabled]}
            onPress={handleReport}
            disabled={!selected}
          >
            <Text style={[styles.reportButtonText, !selected && styles.reportButtonTextDisabled]}>
              Submit Report
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.blockButton} onPress={handleBlock}>
            <Ionicons name="ban" size={18} color="#FF3B30" />
            <Text style={styles.blockButtonText}>Block {targetName}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const C = INCOGNITO_COLORS;

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.background, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 40,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: C.text },
  subtitle: { fontSize: 14, color: C.textLight, marginBottom: 16 },
  reasonRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10, marginBottom: 4,
  },
  reasonRowSelected: { backgroundColor: C.surface },
  reasonText: { fontSize: 14, color: C.text },
  reportButton: {
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginTop: 16,
  },
  reportButtonDisabled: { backgroundColor: C.surface },
  reportButtonText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  reportButtonTextDisabled: { color: C.textLight },
  blockButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, marginTop: 8,
  },
  blockButtonText: { fontSize: 14, fontWeight: '600', color: '#FF3B30' },
});

import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import type { RevealRequestStatus } from '@/types';

const C = INCOGNITO_COLORS;

interface RevealRequestButtonProps {
  status: RevealRequestStatus;
  onRequest: () => void;
  loading?: boolean;
}

export function RevealRequestButton({
  status,
  onRequest,
  loading = false,
}: RevealRequestButtonProps) {
  if (loading) {
    return (
      <TouchableOpacity style={[styles.btn, styles.btnLoading]} disabled>
        <ActivityIndicator size="small" color={C.textLight} />
      </TouchableOpacity>
    );
  }

  switch (status) {
    case 'mutual_accepted':
      return (
        <TouchableOpacity style={[styles.btn, styles.btnRevealed]} disabled>
          <Ionicons name="eye" size={16} color="#00B894" />
          <Text style={[styles.text, { color: '#00B894' }]}>Revealed</Text>
        </TouchableOpacity>
      );

    case 'pending_sent':
      return (
        <TouchableOpacity style={[styles.btn, styles.btnPending]} disabled>
          <Ionicons name="hourglass" size={16} color="#FF9800" />
          <Text style={[styles.text, { color: '#FF9800' }]}>Request sent</Text>
        </TouchableOpacity>
      );

    case 'pending_received':
      return (
        <TouchableOpacity style={[styles.btn, styles.btnReceived]} disabled>
          <Ionicons name="mail-unread" size={16} color={C.primary} />
          <Text style={[styles.text, { color: C.primary }]}>They requested reveal</Text>
        </TouchableOpacity>
      );

    case 'declined':
    case 'none':
    default:
      return (
        <TouchableOpacity style={styles.btn} onPress={onRequest} activeOpacity={0.7}>
          <Ionicons name="eye-off" size={16} color={C.primary} />
          <Text style={[styles.text, { color: C.primary }]}>Request reveal</Text>
        </TouchableOpacity>
      );
  }
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: C.primary + '15',
  },
  btnLoading: { backgroundColor: C.surface },
  btnRevealed: { backgroundColor: '#00B894' + '15' },
  btnPending: { backgroundColor: '#FF9800' + '15' },
  btnReceived: { backgroundColor: C.primary + '15' },
  text: { fontSize: 13, fontWeight: '600' },
});

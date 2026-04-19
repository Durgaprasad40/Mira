import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { TodAvatar } from './TodAvatar';

const C = INCOGNITO_COLORS;

interface ConnectPopupProps {
  visible: boolean;
  userName: string;
  userPhotoUrl?: string;
  userPhotoBlurMode?: 'none' | 'blur';
  userIsAnonymous?: boolean;
  onConnect: () => void;
  onRemove: () => void;
}

export function ConnectPopup({
  visible,
  userName,
  userPhotoUrl,
  userPhotoBlurMode,
  userIsAnonymous,
  onConnect,
  onRemove,
}: ConnectPopupProps) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconRow}>
            <TodAvatar
              size={64}
              photoUrl={userPhotoUrl ?? null}
              isAnonymous={userIsAnonymous}
              photoBlurMode={userPhotoBlurMode ?? 'none'}
              label={userName}
              style={styles.avatar}
              backgroundColor={C.accent}
              textColor={C.text}
              iconColor={C.textLight}
            />
          </View>
          <Text style={styles.title}>{userName}</Text>
          <Text style={styles.subtitle}>liked your prompt answer</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.removeBtn} onPress={onRemove} activeOpacity={0.7}>
              <Ionicons name="close" size={20} color="#F44336" />
              <Text style={styles.removeBtnText}>Remove</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.connectBtn} onPress={onConnect} activeOpacity={0.7}>
              <Ionicons name="chatbubbles" size={20} color="#FFF" />
              <Text style={styles.connectBtnText}>Connect</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>Connect to start a private chat</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  card: {
    backgroundColor: C.surface, borderRadius: 20, padding: 28,
    width: '100%', alignItems: 'center',
  },
  iconRow: { marginBottom: 12 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.accent },
  avatarPlaceholder: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 4 },
  subtitle: { fontSize: 14, color: C.textLight, marginBottom: 20 },
  actions: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  removeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14,
    backgroundColor: '#F4433615', borderWidth: 1, borderColor: '#F4433640',
  },
  removeBtnText: { fontSize: 14, fontWeight: '600', color: '#F44336' },
  connectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14,
    backgroundColor: '#4CAF50',
  },
  connectBtnText: { fontSize: 14, fontWeight: '600', color: '#FFF' },
  hint: { fontSize: 11, color: C.textLight, fontStyle: 'italic' },
});

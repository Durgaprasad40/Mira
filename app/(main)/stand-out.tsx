import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS } from '@/lib/constants';
import { useInteractionStore } from '@/stores/interactionStore';

const STANDOUT_MAX_CHARS = 120;

export default function StandOutScreen() {
  const router = useRouter();
  const { profileId, name, standOutsLeft } = useLocalSearchParams<{
    profileId: string;
    name: string;
    standOutsLeft: string;
  }>();
  const [message, setMessage] = useState('');

  const handleSend = useCallback(() => {
    useInteractionStore.getState().setStandOutResult({
      profileId: profileId || '',
      message: message.trim(),
    });
    router.back();
  }, [profileId, message, router]);

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <View style={styles.overlay}>
      <KeyboardAvoidingView
        style={styles.sheetWrapper}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.box}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>
                Stand Out to {name || 'this person'}
              </Text>
              <Text style={styles.remaining}>
                {standOutsLeft || '0'} Stand Outs left today
              </Text>
            </View>
            <TouchableOpacity onPress={handleClose}>
              <Text style={styles.close}>x</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.subtitle}>
            Write a short message to get noticed
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Say something genuine..."
            placeholderTextColor={COLORS.textMuted}
            value={message}
            onChangeText={setMessage}
            maxLength={STANDOUT_MAX_CHARS}
            autoFocus
          />
          <View style={styles.footer}>
            <Text style={styles.charCount}>
              {message.length}/{STANDOUT_MAX_CHARS}
            </Text>
            <TouchableOpacity style={styles.send} onPress={handleSend}>
              <Ionicons
                name="star"
                size={16}
                color={COLORS.white}
                style={{ marginRight: 6 }}
              />
              <Text style={styles.sendText}>Send Stand Out</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheetWrapper: {
    justifyContent: 'flex-end',
  },
  box: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  remaining: {
    fontSize: 13,
    color: '#2196F3',
    fontWeight: '600',
    marginTop: 2,
  },
  close: {
    fontSize: 20,
    color: COLORS.textLight,
    padding: 4,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: COLORS.text,
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  charCount: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  send: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2196F3',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
  },
  sendText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
});

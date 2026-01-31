import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

type PostType = 'truth' | 'dare';

export default function CreateTodScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [postType, setPostType] = useState<PostType>('truth');
  const [content, setContent] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);

  const maxLength = 280;
  const canSubmit = content.trim().length >= 10;

  const handleSubmit = () => {
    if (!canSubmit) return;
    // Demo mode: just show success and go back
    Alert.alert(
      'Posted!',
      `Your ${postType} has been shared${isAnonymous ? ' anonymously' : ''}.`,
      [{ text: 'OK', onPress: () => router.back() }]
    );
  };

  const C = INCOGNITO_COLORS;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Post</Text>
        <TouchableOpacity
          style={[styles.postButton, !canSubmit && styles.postButtonDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          <Text style={[styles.postButtonText, !canSubmit && styles.postButtonTextDisabled]}>Post</Text>
        </TouchableOpacity>
      </View>

      {/* Type Selector */}
      <View style={styles.typeSelector}>
        <TouchableOpacity
          style={[styles.typeOption, postType === 'truth' && styles.typeOptionActive]}
          onPress={() => setPostType('truth')}
        >
          <Ionicons name="help-circle" size={20} color={postType === 'truth' ? '#FFFFFF' : C.textLight} />
          <Text style={[styles.typeLabel, postType === 'truth' && styles.typeLabelActive]}>Truth</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeOption, postType === 'dare' && styles.typeOptionDareActive]}
          onPress={() => setPostType('dare')}
        >
          <Ionicons name="flash" size={20} color={postType === 'dare' ? '#FFFFFF' : C.textLight} />
          <Text style={[styles.typeLabel, postType === 'dare' && styles.typeLabelActive]}>Dare</Text>
        </TouchableOpacity>
      </View>

      {/* Input */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.textInput}
          placeholder={
            postType === 'truth'
              ? 'Ask a truth question...'
              : 'Write a dare challenge...'
          }
          placeholderTextColor={C.textLight}
          multiline
          maxLength={maxLength}
          value={content}
          onChangeText={setContent}
          autoFocus
        />
        <Text style={styles.charCount}>
          {content.length}/{maxLength}
        </Text>
      </View>

      {/* Options */}
      <View style={styles.optionsContainer}>
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => setIsAnonymous(!isAnonymous)}
        >
          <View style={styles.optionLeft}>
            <Ionicons name="eye-off" size={20} color={C.textLight} />
            <Text style={styles.optionLabel}>Post anonymously</Text>
          </View>
          <Ionicons
            name={isAnonymous ? 'checkbox' : 'square-outline'}
            size={22}
            color={isAnonymous ? C.primary : C.textLight}
          />
        </TouchableOpacity>
      </View>

      {/* Tips */}
      <View style={styles.tipsContainer}>
        <Text style={styles.tipsTitle}>Tips:</Text>
        {postType === 'truth' ? (
          <>
            <Text style={styles.tipText}>Ask open-ended, fun questions</Text>
            <Text style={styles.tipText}>Keep it respectful and engaging</Text>
            <Text style={styles.tipText}>Questions about experiences work best</Text>
          </>
        ) : (
          <>
            <Text style={styles.tipText}>Make dares fun and safe</Text>
            <Text style={styles.tipText}>Avoid anything harmful or dangerous</Text>
            <Text style={styles.tipText}>Creative dares get more responses</Text>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const C = INCOGNITO_COLORS;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 18, fontWeight: '600', color: C.text },
  postButton: {
    paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20,
    backgroundColor: C.primary,
  },
  postButtonDisabled: { backgroundColor: C.surface },
  postButtonText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  postButtonTextDisabled: { color: C.textLight },

  typeSelector: {
    flexDirection: 'row', padding: 16, gap: 12,
  },
  typeOption: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderRadius: 12, gap: 8,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.surface,
  },
  typeOptionActive: { backgroundColor: '#6C5CE7', borderColor: '#6C5CE7' },
  typeOptionDareActive: { backgroundColor: '#E17055', borderColor: '#E17055' },
  typeLabel: { fontSize: 15, fontWeight: '600', color: C.textLight },
  typeLabelActive: { color: '#FFFFFF' },

  inputContainer: {
    paddingHorizontal: 16, paddingVertical: 8,
  },
  textInput: {
    fontSize: 16, color: C.text, minHeight: 120, textAlignVertical: 'top',
    backgroundColor: C.surface, borderRadius: 12, padding: 16, lineHeight: 24,
  },
  charCount: {
    fontSize: 12, color: C.textLight, textAlign: 'right', marginTop: 8,
  },

  optionsContainer: { paddingHorizontal: 16, paddingVertical: 8 },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 14, backgroundColor: C.surface, borderRadius: 12,
  },
  optionLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  optionLabel: { fontSize: 14, color: C.text },

  tipsContainer: { padding: 16, marginTop: 8 },
  tipsTitle: { fontSize: 14, fontWeight: '600', color: C.textLight, marginBottom: 8 },
  tipText: { fontSize: 13, color: C.textLight, marginBottom: 4, paddingLeft: 8 },
});

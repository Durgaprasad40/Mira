/**
 * Chat Theme Selector
 *
 * Modal component for selecting chat room visual themes.
 * Shows 4 theme options with live preview colors.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useChatThemeStore } from '@/stores/chatThemeStore';
import { getAllThemes, ChatThemeId } from '@/lib/chatThemes';

const C = INCOGNITO_COLORS;

interface ChatThemeSelectorProps {
  visible: boolean;
  onClose: () => void;
}

export default function ChatThemeSelector({ visible, onClose }: ChatThemeSelectorProps) {
  const currentThemeId = useChatThemeStore((s) => s.themeId);
  const setTheme = useChatThemeStore((s) => s.setTheme);
  const themes = getAllThemes();

  const handleSelectTheme = (themeId: ChatThemeId) => {
    setTheme(themeId);
    // Don't close immediately - let user see the change
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={styles.container} onStartShouldSetResponder={() => true}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Chat Theme</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={24} color={C.text} />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>Choose a visual style for chat rooms</Text>

          {/* Theme Options */}
          <ScrollView style={styles.themeList} showsVerticalScrollIndicator={false}>
            {themes.map((theme) => {
              const isSelected = theme.id === currentThemeId;
              return (
                <TouchableOpacity
                  key={theme.id}
                  style={[styles.themeOption, isSelected && styles.themeOptionSelected]}
                  onPress={() => handleSelectTheme(theme.id)}
                  activeOpacity={0.7}
                >
                  {/* Color Preview */}
                  <View style={styles.colorPreview}>
                    <View style={[styles.colorSwatch, { backgroundColor: theme.colors.background }]} />
                    <View style={[styles.colorSwatch, { backgroundColor: theme.colors.bubbleMe }]} />
                    <View style={[styles.colorSwatch, { backgroundColor: theme.colors.primary }]} />
                  </View>

                  {/* Theme Info */}
                  <View style={styles.themeInfo}>
                    <Text style={styles.themeName}>{theme.name}</Text>
                    <Text style={styles.themeDescription}>{theme.description}</Text>
                  </View>

                  {/* Selected Indicator */}
                  {isSelected && (
                    <View style={styles.checkmark}>
                      <Ionicons name="checkmark-circle" size={24} color={C.primary} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: C.text,
  },
  subtitle: {
    fontSize: 13,
    color: C.textLight,
    marginBottom: 20,
  },
  themeList: {
    flexGrow: 0,
  },
  themeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginBottom: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  themeOptionSelected: {
    borderColor: C.primary,
    backgroundColor: 'rgba(233, 69, 96, 0.08)',
  },
  colorPreview: {
    flexDirection: 'row',
    marginRight: 14,
    gap: 4,
  },
  colorSwatch: {
    width: 20,
    height: 36,
    borderRadius: 6,
  },
  themeInfo: {
    flex: 1,
  },
  themeName: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    marginBottom: 2,
  },
  themeDescription: {
    fontSize: 12,
    color: C.textLight,
  },
  checkmark: {
    marginLeft: 8,
  },
});

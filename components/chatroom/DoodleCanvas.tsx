import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  PanResponder,
  Modal,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { captureRef } from 'react-native-view-shot';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CANVAS_SIZE = SCREEN_WIDTH - 32;

const COLORS = ['#FFFFFF', '#E94560', '#00B894', '#74B9FF', '#FDCB6E', '#A29BFE'];

interface DoodleCanvasProps {
  visible: boolean;
  onClose: () => void;
  onSend: (uri: string) => void;
}

export default function DoodleCanvas({ visible, onClose, onSend }: DoodleCanvasProps) {
  const [paths, setPaths] = useState<{ d: string; color: string; width: number }[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [selectedColor, setSelectedColor] = useState('#FFFFFF');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const canvasRef = useRef<View>(null);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        setCurrentPath(`M${locationX},${locationY}`);
      },
      onPanResponderMove: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        setCurrentPath((prev) => `${prev} L${locationX},${locationY}`);
      },
      onPanResponderRelease: () => {
        setCurrentPath((prev) => {
          if (prev) {
            setPaths((old) => [...old, { d: prev, color: selectedColor, width: strokeWidth }]);
          }
          return '';
        });
      },
    })
  ).current;

  const handleClear = useCallback(() => {
    setPaths([]);
    setCurrentPath('');
  }, []);

  const handleUndo = useCallback(() => {
    setPaths((prev) => prev.slice(0, -1));
  }, []);

  const handleSend = useCallback(async () => {
    if (paths.length === 0 && !currentPath) return;
    try {
      if (canvasRef.current) {
        const uri = await captureRef(canvasRef.current, {
          format: 'png',
          quality: 0.9,
        });
        onSend(uri);
      }
    } catch {
      // Fallback: send a placeholder
      onSend('doodle://sent');
    }
    handleClear();
    onClose();
  }, [paths, currentPath, onSend, onClose, handleClear]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Doodle</Text>
          <TouchableOpacity onPress={handleSend} style={styles.sendBtn}>
            <Text style={styles.sendText}>Send</Text>
          </TouchableOpacity>
        </View>

        {/* Canvas */}
        <View
          ref={canvasRef}
          style={styles.canvas}
          {...panResponder.panHandlers}
          collapsable={false}
        >
          <Svg width={CANVAS_SIZE} height={CANVAS_SIZE}>
            {paths.map((p, i) => (
              <Path
                key={i}
                d={p.d}
                stroke={p.color}
                strokeWidth={p.width}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {currentPath ? (
              <Path
                d={currentPath}
                stroke={selectedColor}
                strokeWidth={strokeWidth}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </Svg>
        </View>

        {/* Tools */}
        <View style={styles.tools}>
          <View style={styles.colorRow}>
            {COLORS.map((color) => (
              <TouchableOpacity
                key={color}
                style={[
                  styles.colorDot,
                  { backgroundColor: color },
                  selectedColor === color && styles.colorDotSelected,
                ]}
                onPress={() => setSelectedColor(color)}
              />
            ))}
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.toolBtn} onPress={handleUndo}>
              <Ionicons name="arrow-undo" size={20} color={C.text} />
              <Text style={styles.toolLabel}>Undo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolBtn} onPress={handleClear}>
              <Ionicons name="trash-outline" size={20} color={C.text} />
              <Text style={styles.toolLabel}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.toolBtn}
              onPress={() => setStrokeWidth((prev) => (prev >= 8 ? 2 : prev + 2))}
            >
              <View style={[styles.sizePreview, { width: strokeWidth * 3, height: strokeWidth * 3 }]} />
              <Text style={styles.toolLabel}>Size</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
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
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.accent,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
  },
  sendBtn: {
    backgroundColor: C.primary,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 14,
  },
  sendText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  canvas: {
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    alignSelf: 'center',
    marginTop: 16,
    backgroundColor: '#2C2C3A',
    borderRadius: 12,
    overflow: 'hidden',
  },
  tools: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  colorRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  colorDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorDotSelected: {
    borderColor: C.primary,
    borderWidth: 3,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 28,
  },
  toolBtn: {
    alignItems: 'center',
    gap: 4,
  },
  toolLabel: {
    fontSize: 10,
    color: C.textLight,
    fontWeight: '600',
  },
  sizePreview: {
    backgroundColor: C.text,
    borderRadius: 12,
    minWidth: 6,
    minHeight: 6,
  },
});

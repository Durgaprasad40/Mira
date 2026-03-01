/**
 * InAppVideoRecorder - In-app video recording modal
 * Records video using expo-camera, shows preview with Cancel/Replace/Continue buttons.
 * No system preview, no external apps.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Video, ResizeMode } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;
const MAX_DURATION_SEC = 60;

interface InAppVideoRecorderProps {
  visible: boolean;
  onClose: () => void;
  onVideoRecorded: (uri: string, durationMs: number) => void;
}

type RecorderState = 'ready' | 'recording' | 'preview';

export function InAppVideoRecorder({
  visible,
  onClose,
  onVideoRecorded,
}: InAppVideoRecorderProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<RecorderState>('ready');
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const cameraRef = useRef<CameraView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setState('ready');
      setRecordedUri(null);
      setRecordSeconds(0);
      setIsLoading(false);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [visible]);

  // Recording timer
  useEffect(() => {
    if (state === 'recording') {
      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          if (s >= MAX_DURATION_SEC - 1) {
            stopRecording();
            return MAX_DURATION_SEC;
          }
          return s + 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state]);

  const startRecording = useCallback(async () => {
    if (!cameraRef.current || state !== 'ready') return;

    try {
      setState('recording');
      setRecordSeconds(0);

      const video = await cameraRef.current.recordAsync({
        maxDuration: MAX_DURATION_SEC,
      });

      if (video?.uri) {
        setRecordedUri(video.uri);
        setState('preview');
        console.log(`[T/D VideoRecorder] Video recorded: ${video.uri}`);
      } else {
        setState('ready');
      }
    } catch (error) {
      console.error('[T/D VideoRecorder] Recording error:', error);
      setState('ready');
    }
  }, [state]);

  const stopRecording = useCallback(async () => {
    if (!cameraRef.current || state !== 'recording') return;

    try {
      setIsLoading(true);
      await cameraRef.current.stopRecording();
      // The recordAsync promise will resolve with the video
    } catch (error) {
      console.error('[T/D VideoRecorder] Stop error:', error);
      setState('ready');
    } finally {
      setIsLoading(false);
    }
  }, [state]);

  const handleCancel = useCallback(() => {
    setState('ready');
    setRecordedUri(null);
    setRecordSeconds(0);
    onClose();
  }, [onClose]);

  const handleReplace = useCallback(() => {
    // Discard current recording and go back to ready state
    setRecordedUri(null);
    setRecordSeconds(0);
    setState('ready');
  }, []);

  const handleContinue = useCallback(() => {
    if (recordedUri) {
      const durationMs = recordSeconds * 1000;
      onVideoRecorded(recordedUri, durationMs);
      // Reset state for next use
      setState('ready');
      setRecordedUri(null);
      setRecordSeconds(0);
    }
  }, [recordedUri, recordSeconds, onVideoRecorded]);

  const formatTime = (s: number) => {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  // Request permission if not granted
  useEffect(() => {
    if (visible && permission && !permission.granted) {
      requestPermission();
    }
  }, [visible, permission, requestPermission]);

  if (!visible) return null;

  // Permission check
  if (!permission) {
    return (
      <Modal visible={visible} transparent animationType="fade">
        <View style={styles.container}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </Modal>
    );
  }

  if (!permission.granted) {
    return (
      <Modal visible={visible} transparent animationType="fade">
        <View style={styles.container}>
          <View style={styles.permissionBox}>
            <Ionicons name="videocam-off" size={48} color={C.textLight} />
            <Text style={styles.permissionText}>
              Camera permission is required to record video.
            </Text>
            <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
              <Text style={styles.permissionBtnText}>Grant Permission</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent={false} animationType="slide">
      <View style={styles.container}>
        {/* Preview State - Show recorded video */}
        {state === 'preview' && recordedUri && (
          <View style={styles.previewContainer}>
            <Video
              source={{ uri: recordedUri }}
              style={styles.previewVideo}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay
              isLooping
              isMuted={false}
            />

            {/* Preview Controls: Cancel / Replace / Continue */}
            <View style={styles.previewControls}>
              <TouchableOpacity style={styles.previewBtn} onPress={handleCancel}>
                <View style={[styles.previewBtnCircle, styles.cancelCircle]}>
                  <Ionicons name="close" size={28} color="#FFF" />
                </View>
                <Text style={styles.previewBtnLabel}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.previewBtn} onPress={handleReplace}>
                <View style={[styles.previewBtnCircle, styles.replaceCircle]}>
                  <Ionicons name="refresh" size={28} color="#FFF" />
                </View>
                <Text style={styles.previewBtnLabel}>Retake</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.previewBtn} onPress={handleContinue}>
                <View style={[styles.previewBtnCircle, styles.continueCircle]}>
                  <Ionicons name="checkmark" size={28} color="#FFF" />
                </View>
                <Text style={styles.previewBtnLabel}>Use Video</Text>
              </TouchableOpacity>
            </View>

            {/* Duration indicator */}
            <View style={styles.durationBadge}>
              <Ionicons name="time-outline" size={14} color="#FFF" />
              <Text style={styles.durationText}>{formatTime(recordSeconds)}</Text>
            </View>
          </View>
        )}

        {/* Recording/Ready State - Show camera */}
        {(state === 'ready' || state === 'recording') && (
          <>
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing="back"
              mode="video"
            />

            {/* Top bar with close button */}
            <View style={styles.topBar}>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={handleCancel}
                disabled={state === 'recording'}
              >
                <Ionicons name="close" size={28} color="#FFF" />
              </TouchableOpacity>

              {/* Recording indicator */}
              {state === 'recording' && (
                <View style={styles.recordingIndicator}>
                  <View style={styles.recordingDot} />
                  <Text style={styles.recordingTime}>{formatTime(recordSeconds)}</Text>
                </View>
              )}
            </View>

            {/* Bottom controls */}
            <View style={styles.bottomBar}>
              {state === 'ready' && (
                <TouchableOpacity
                  style={styles.recordBtn}
                  onPress={startRecording}
                  disabled={isLoading}
                >
                  <View style={styles.recordBtnInner} />
                </TouchableOpacity>
              )}

              {state === 'recording' && (
                <TouchableOpacity
                  style={styles.stopBtn}
                  onPress={stopRecording}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <View style={styles.stopBtnInner} />
                  )}
                </TouchableOpacity>
              )}

              <Text style={styles.hintText}>
                {state === 'ready' ? 'Tap to record' : 'Tap to stop'}
              </Text>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },

  // Top bar
  topBar: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 8,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#F44336',
  },
  recordingTime: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 16,
  },
  recordBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFF',
  },
  recordBtnInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F44336',
  },
  stopBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#F44336',
  },
  stopBtnInner: {
    width: 32,
    height: 32,
    borderRadius: 4,
    backgroundColor: '#F44336',
  },
  hintText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '500',
  },

  // Preview state
  previewContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  previewVideo: {
    flex: 1,
  },
  previewControls: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  previewBtn: {
    alignItems: 'center',
    gap: 8,
  },
  previewBtnCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelCircle: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  replaceCircle: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  continueCircle: {
    backgroundColor: C.primary,
  },
  previewBtnLabel: {
    fontSize: 12,
    color: '#FFF',
    fontWeight: '500',
  },
  durationBadge: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  durationText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
  },

  // Permission UI
  permissionBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  permissionText: {
    fontSize: 16,
    color: C.text,
    textAlign: 'center',
  },
  permissionBtn: {
    backgroundColor: C.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  permissionBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
  },
  cancelBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  cancelBtnText: {
    fontSize: 14,
    color: C.textLight,
  },
});

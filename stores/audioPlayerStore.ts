/**
 * Audio Player Store (v2)
 *
 * Centralized audio playback with proper state machine.
 * Ensures only one audio plays at a time with reliable replay.
 *
 * State machine: idle → loading → playing ⇄ paused → completed → (replay restarts)
 */
import { create } from 'zustand';
import { Audio, AVPlaybackStatus } from 'expo-av';

type AudioState = 'idle' | 'loading' | 'playing' | 'paused' | 'completed' | 'error';

interface AudioPlayerState {
  // State machine
  state: AudioState;
  currentMessageId: string | null;
  currentAudioUrl: string | null;
  // Progress tracking
  progress: number; // 0-1
  durationMs: number;
  positionMs: number;
  // Error info
  errorMessage: string | null;
  // Backward-compatible boolean flags (derived from state)
  isPlaying: boolean;
  isLoading: boolean;
  isCompleted: boolean;

  // Internal - not for external use
  _sound: Audio.Sound | null;
  _instanceId: number; // Tracks callback validity

  // Public actions
  toggle: (messageId: string, audioUrl: string) => Promise<void>;
  cleanup: () => Promise<void>;
}

/** Derives boolean flags from state machine value */
function deriveFlags(state: AudioState) {
  return {
    isPlaying: state === 'playing',
    isLoading: state === 'loading',
    isCompleted: state === 'completed',
  };
}

// Instance counter to invalidate stale callbacks
let instanceCounter = 0;

export const useAudioPlayerStore = create<AudioPlayerState>((set, get) => ({
  state: 'idle',
  currentMessageId: null,
  currentAudioUrl: null,
  progress: 0,
  durationMs: 0,
  positionMs: 0,
  errorMessage: null,
  isPlaying: false,
  isLoading: false,
  isCompleted: false,
  _sound: null,
  _instanceId: 0,

  /**
   * Main entry point: toggles playback for a message
   * - If this audio is playing → pause
   * - If this audio is paused → resume
   * - If this audio is completed → restart from beginning
   * - If different audio or idle → load and play this audio
   */
  toggle: async (messageId: string, audioUrl: string) => {
    const { state, currentMessageId, _sound } = get();

    // Case 1: Same audio is playing → pause it
    if (currentMessageId === messageId && state === 'playing' && _sound) {
      try {
        await _sound.pauseAsync();
        set({ state: 'paused', ...deriveFlags('paused') });
      } catch (e) {
        console.error('[AudioPlayer] Pause failed:', e);
      }
      return;
    }

    // Case 2: Same audio is paused → resume it
    if (currentMessageId === messageId && state === 'paused' && _sound) {
      try {
        await _sound.playAsync();
        set({ state: 'playing', ...deriveFlags('playing') });
      } catch (e) {
        console.error('[AudioPlayer] Resume failed:', e);
        // Try full reload on resume failure
        await loadAndPlay(messageId, audioUrl, set, get);
      }
      return;
    }

    // Case 3: Same audio is completed → seek to start and play
    if (currentMessageId === messageId && state === 'completed' && _sound) {
      try {
        await _sound.setPositionAsync(0);
        await _sound.playAsync();
        set({ state: 'playing', progress: 0, positionMs: 0, ...deriveFlags('playing') });
      } catch (e) {
        console.error('[AudioPlayer] Replay failed:', e);
        // Full reload on seek failure
        await loadAndPlay(messageId, audioUrl, set, get);
      }
      return;
    }

    // Case 4: Different audio or fresh start → load and play
    await loadAndPlay(messageId, audioUrl, set, get);
  },

  cleanup: async () => {
    const { _sound } = get();
    if (_sound) {
      try {
        await _sound.unloadAsync();
      } catch {
        // Ignore cleanup errors
      }
    }
    set({
      state: 'idle',
      currentMessageId: null,
      currentAudioUrl: null,
      progress: 0,
      durationMs: 0,
      positionMs: 0,
      errorMessage: null,
      _sound: null,
      ...deriveFlags('idle'),
    });
  },
}));

/**
 * Loads a new audio file and starts playback
 * Unloads any existing audio first
 */
async function loadAndPlay(
  messageId: string,
  audioUrl: string,
  set: (state: Partial<AudioPlayerState>) => void,
  get: () => AudioPlayerState
) {
  // Generate new instance ID to invalidate stale callbacks
  const thisInstanceId = ++instanceCounter;

  // Cleanup existing sound first
  const { _sound: existingSound } = get();
  if (existingSound) {
    try {
      await existingSound.unloadAsync();
    } catch {
      // Ignore unload errors
    }
  }

  // Set loading state
  set({
    state: 'loading',
    currentMessageId: messageId,
    currentAudioUrl: audioUrl,
    progress: 0,
    positionMs: 0,
    durationMs: 0,
    errorMessage: null,
    _sound: null,
    _instanceId: thisInstanceId,
    ...deriveFlags('loading'),
  });

  try {
    // Configure audio mode
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
    });

    // Create and load the sound
    const { sound } = await Audio.Sound.createAsync(
      { uri: audioUrl },
      { shouldPlay: true },
      (status: AVPlaybackStatus) => {
        // Ignore callbacks from stale instances
        if (get()._instanceId !== thisInstanceId) {
          return;
        }

        if (!status.isLoaded) {
          // Handle unload/error
          const errorStatus = status as { error?: string };
          if (errorStatus.error) {
            console.error('[AudioPlayer] Playback error:', errorStatus.error);
            set({
              state: 'error',
              errorMessage: errorStatus.error,
              ...deriveFlags('error'),
            });
          }
          return;
        }

        const duration = status.durationMillis ?? 0;
        const position = status.positionMillis ?? 0;
        const progress = duration > 0 ? position / duration : 0;

        if (status.didJustFinish) {
          // Audio completed - set to completed state
          set({
            state: 'completed',
            progress: 1,
            positionMs: duration,
            durationMs: duration,
            ...deriveFlags('completed'),
          });
        } else if (status.isPlaying) {
          set({
            state: 'playing',
            progress,
            positionMs: position,
            durationMs: duration,
            ...deriveFlags('playing'),
          });
        } else {
          // Paused or buffering
          const currentState = get().state;
          if (currentState === 'playing') {
            // Transitioned from playing to not playing = paused
            set({
              state: 'paused',
              progress,
              positionMs: position,
              durationMs: duration,
              ...deriveFlags('paused'),
            });
          } else if (currentState === 'loading') {
            // Still loading, update duration info only
            set({
              durationMs: duration,
            });
          }
        }
      }
    );

    // Verify this is still the active instance
    if (get()._instanceId !== thisInstanceId) {
      // Another audio was started, unload this one
      await sound.unloadAsync();
      return;
    }

    // Update state with sound reference
    set({
      _sound: sound,
      state: 'playing',
      ...deriveFlags('playing'),
    });
  } catch (error) {
    // Verify this is still the active instance
    if (get()._instanceId !== thisInstanceId) {
      return;
    }

    console.error('[AudioPlayer] Load failed:', error);
    set({
      state: 'error',
      errorMessage: error instanceof Error ? error.message : 'Failed to load audio',
      _sound: null,
      ...deriveFlags('error'),
    });
  }
}

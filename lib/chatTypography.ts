import React from 'react';
import {
  Dimensions,
  Text,
  type StyleProp,
  type TextProps,
  type TextStyle,
} from 'react-native';

export const CHAT_TYPOGRAPHY = {
  bubbleBody: {
    fontSize: 15,
    lineHeight: 20,
    maxFontSizeMultiplier: 1.6,
  },
  bubbleMeta: {
    fontSize: 11,
    lineHeight: 14,
    maxFontSizeMultiplier: 1.3,
  },
  systemNotice: {
    fontSize: 12,
    lineHeight: 16,
    maxFontSizeMultiplier: 1.3,
  },
  inboxName: {
    fontSize: 15,
    lineHeight: 19,
    maxFontSizeMultiplier: 1.4,
  },
  inboxPreview: {
    fontSize: 13,
    lineHeight: 17,
    maxFontSizeMultiplier: 1.5,
  },
  inboxMeta: {
    fontSize: 11,
    lineHeight: 14,
    maxFontSizeMultiplier: 1.3,
  },
  inputField: {
    fontSize: 15,
    lineHeight: 20,
    maxFontSizeMultiplier: 1.4,
  },
  voiceMeta: {
    fontSize: 11,
    lineHeight: 14,
    maxFontSizeMultiplier: 1.3,
  },
  mediaCaption: {
    fontSize: 12,
    lineHeight: 16,
    maxFontSizeMultiplier: 1.3,
  },
  truthDareTitle: {
    fontSize: 14,
    lineHeight: 18,
    maxFontSizeMultiplier: 1.3,
  },
} as const;

export const CHAT_DENSITY = {
  bubblePaddingV: 8,
  bubblePaddingH: 12,
  bubbleRadius: 18,
  bubbleTailRadius: 4,
  bubbleGapSameSender: 2,
  bubbleGapNewSender: 8,
  rowAvatarSize: 36,
  rowVerticalPadding: 10,
  rowHorizontalPadding: 16,
  inputMinHeight: 40,
  inputPaddingV: 10,
  systemMessageMargin: 12,
} as const;

export type ChatTypographyVariant = keyof typeof CHAT_TYPOGRAPHY;

const FALLBACK_SCREEN_WIDTH = 300;

function getSafeScreenWidth(screenWidth?: number): number {
  if (typeof screenWidth === 'number' && Number.isFinite(screenWidth) && screenWidth > 0) {
    return screenWidth;
  }

  const windowWidth = Dimensions.get('window')?.width;
  if (typeof windowWidth === 'number' && Number.isFinite(windowWidth) && windowWidth > 0) {
    return windowWidth;
  }

  return FALLBACK_SCREEN_WIDTH;
}

export function getChatBubbleMaxWidth(screenWidth?: number): number {
  const width = getSafeScreenWidth(screenWidth);
  return Math.min(width * 0.76, 320);
}

export type ChatTextProps = Omit<TextProps, 'style' | 'maxFontSizeMultiplier'> & {
  variant: ChatTypographyVariant;
  style?: StyleProp<TextStyle>;
};

export function ChatText({ variant, style, ...props }: ChatTextProps) {
  const token = CHAT_TYPOGRAPHY[variant];

  return React.createElement(Text, {
    ...props,
    maxFontSizeMultiplier: token.maxFontSizeMultiplier,
    style: [
      {
        fontSize: token.fontSize,
        lineHeight: token.lineHeight,
      },
      style,
    ],
  });
}

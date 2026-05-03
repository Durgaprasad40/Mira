export type TodAnswerIdentityMode = 'anonymous' | 'no_photo' | 'profile' | null | undefined;
export type TodPhotoBlurMode = 'none' | 'open' | 'blur' | null | undefined;

export function resolveAnswerPreviewIdentity(answer: {
  isAnonymous?: boolean | null;
  identityMode?: TodAnswerIdentityMode;
  photoBlurMode?: TodPhotoBlurMode;
  authorName?: string | null;
  authorPhotoUrl?: string | null;
}): {
  isAnonymous: boolean;
  displayName: string;
  photoUrl: string | null;
  photoBlurMode: 'none' | 'blur';
} {
  const identityMode =
    answer.identityMode === 'anonymous' ||
    answer.identityMode === 'no_photo' ||
    answer.identityMode === 'profile'
      ? answer.identityMode
      : answer.isAnonymous !== false
        ? 'anonymous'
        : answer.photoBlurMode === 'blur'
          ? 'no_photo'
          : 'profile';

  const isAnonymous = identityMode === 'anonymous';
  const photoBlurMode = identityMode === 'no_photo' || answer.photoBlurMode === 'blur' ? 'blur' : 'none';

  return {
    isAnonymous,
    displayName: isAnonymous ? 'Anonymous' : (answer.authorName?.trim() || 'User'),
    photoUrl: isAnonymous ? null : (answer.authorPhotoUrl?.trim() || null),
    photoBlurMode,
  };
}

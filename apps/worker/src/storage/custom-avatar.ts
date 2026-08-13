export const CUSTOM_AVATAR_BYTES = 50 * 1_024;
export const CUSTOM_AVATAR_DIMENSION = 256;

export function customAvatarUrl(userId: string, version: number | null): string | null {
  if (version === null) return null;
  return `/api/avatars/${encodeURIComponent(userId)}/v${version}.webp`;
}

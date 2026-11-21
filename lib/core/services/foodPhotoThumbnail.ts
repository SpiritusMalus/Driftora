/// Bound storage/read costs independently of the upload-sized photo. These
/// bytes come only from a native JPEG re-encode of the user's selected image.
export const MAX_FOOD_PHOTO_BASE64_LENGTH = 180_000;

export function isFoodPhotoBase64(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 &&
    value.length <= MAX_FOOD_PHOTO_BASE64_LENGTH && value.length % 4 === 0 &&
    value.startsWith('/9j/') && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

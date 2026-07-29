const PHOTO_EXTS = ['jpg', 'jpeg', 'png', 'webp'];

// DB(photos.file_path) 저장용 규약 문자열: photos/{photo_id}.{ext} (스펙 §6.3)
export function photoFilePath(photoId: string, filename: string): string | null {
  const parts = filename.split('.');
  if (parts.length < 2) return null;
  const ext = parts.pop()!.toLowerCase();
  if (!PHOTO_EXTS.includes(ext)) return null;
  return `photos/${photoId}.${ext}`;
}

// Storage 버킷('photos') 내 객체 키: 규약 문자열에서 버킷 접두를 제거
export function photoStorageKey(filePath: string): string {
  return filePath.replace(/^photos\//, '');
}

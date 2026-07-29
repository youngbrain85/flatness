import { describe, expect, it } from 'vitest';
import { photoFilePath, photoStorageKey } from '../paths';

describe('사진 경로 규약 (스펙 §6.3: photos/{photo_id}.{ext})', () => {
  it('허용 확장자는 규약 문자열을 만든다(소문자화)', () => {
    expect(photoFilePath('p1', 'IMG_001.JPG')).toBe('photos/p1.jpg');
    expect(photoFilePath('p1', 'a.png')).toBe('photos/p1.png');
  });
  it('허용 외 확장자는 null', () => {
    expect(photoFilePath('p1', 'a.exe')).toBeNull();
    expect(photoFilePath('p1', 'noext')).toBeNull();
  });
  it('storageKey는 접두 photos/를 제거한 버킷 내 키', () => {
    expect(photoStorageKey('photos/p1.jpg')).toBe('p1.jpg');
  });
});

import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, UNIT_OPTIONS, isUploadSizeAllowed, validateScanFile } from '../validate';

describe('validateScanFile (스펙 §5.1.1 런치 포맷)', () => {
  it('지원 확장자 7종을 허용한다(대소문자 무시)', () => {
    for (const ext of ['ply', 'las', 'laz', 'xyz', 'txt', 'csv', 'pts']) {
      expect(validateScanFile(`scan.${ext}`)).toEqual({ ext });
    }
    expect(validateScanFile('SCAN.PLY')).toEqual({ ext: 'ply' });
  });
  it('E57 등 미지원 확장자·확장자 없음은 거부', () => {
    expect(validateScanFile('scan.e57')).toBeNull();
    expect(validateScanFile('scan')).toBeNull();
  });
});

describe('UNIT_OPTIONS', () => {
  it('m/cm/mm 배율', () => {
    expect(UNIT_OPTIONS.map((o) => o.value)).toEqual([1.0, 0.01, 0.001]);
  });
});

describe('isUploadSizeAllowed (리뷰 Important #3: 업로드 크기 상한 1GiB)', () => {
  it('상한 이하(경계값 포함)는 허용한다', () => {
    expect(isUploadSizeAllowed(0)).toBe(true);
    expect(isUploadSizeAllowed(MAX_UPLOAD_BYTES)).toBe(true); // 경계값 통과
  });
  it('상한을 1바이트라도 초과하면 거부한다', () => {
    expect(isUploadSizeAllowed(MAX_UPLOAD_BYTES + 1)).toBe(false);
  });
});

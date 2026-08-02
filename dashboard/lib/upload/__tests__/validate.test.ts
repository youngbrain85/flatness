import { describe, expect, it } from 'vitest';
import {
  IMPORT_EXTS, MAX_UPLOAD_BYTES, UNIT_OPTIONS,
  isUploadSizeAllowed, validateFile, validateScanFile,
} from '../validate';

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
  it('스캔 원본 검증은 JSON을 허용하지 않는다(JSON은 임포트 전용 — B4)', () => {
    expect(validateScanFile('result.json')).toBeNull();
  });
});

describe('validateFile + IMPORT_EXTS (B4: 기존 결과 가져오기 CSV/JSON 지원)', () => {
  it('허용 목록을 넘기면 그 목록만 기준으로 판정한다', () => {
    for (const ext of IMPORT_EXTS) {
      expect(validateFile(`result.${ext}`, IMPORT_EXTS)).toEqual({ ext });
    }
    expect(validateFile('scan.ply', IMPORT_EXTS)).toBeNull();
  });
  it('허용 목록 생략 시 SCAN_EXTS와 동일하게 동작한다', () => {
    expect(validateFile('scan.ply')).toEqual({ ext: 'ply' });
    expect(validateFile('result.json')).toBeNull();
  });
});

describe('UNIT_OPTIONS', () => {
  it('m/cm/mm 배율', () => {
    expect(UNIT_OPTIONS.map((o) => o.value)).toEqual([1.0, 0.01, 0.001]);
  });
});

describe('isUploadSizeAllowed (Supabase Free 티어 상한 50MB)', () => {
  it('상한 이하(경계값 포함)는 허용한다', () => {
    expect(isUploadSizeAllowed(0)).toBe(true);
    expect(isUploadSizeAllowed(MAX_UPLOAD_BYTES)).toBe(true); // 경계값 통과
  });
  it('상한을 1바이트라도 초과하면 거부한다', () => {
    expect(isUploadSizeAllowed(MAX_UPLOAD_BYTES + 1)).toBe(false);
  });
  it('50MB 초과는 거부한다', () => {
    expect(isUploadSizeAllowed(52428800)).toBe(true);
    expect(isUploadSizeAllowed(52428801)).toBe(false);
  });
});

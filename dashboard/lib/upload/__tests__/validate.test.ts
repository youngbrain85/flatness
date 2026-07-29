import { describe, expect, it } from 'vitest';
import { UNIT_OPTIONS, validateScanFile } from '../validate';

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

import { describe, expect, it } from 'vitest';
import { artifactUrl, dataUrl, rawScanRelPath } from '../paths';

describe('경로 결합 (버킷-상대 규약 문자열 -> /api/data URL)', () => {
  it('상대 규약 문자열을 서빙 URL로 바꾼다', () => {
    expect(dataUrl('artifacts/a1/stats.json')).toBe('/api/data/artifacts/a1/stats.json');
  });
  it('선행 슬래시를 정규화한다', () => {
    expect(dataUrl('/artifacts/a1/heatmap.png')).toBe('/api/data/artifacts/a1/heatmap.png');
  });
  it('세그먼트를 URL 인코딩한다', () => {
    expect(dataUrl('artifacts/a 1/x.png')).toBe('/api/data/artifacts/a%201/x.png');
  });
  it('artifactUrl은 artifacts_dir + 파일명 결합', () => {
    expect(artifactUrl('artifacts/a1', 'cells.json')).toBe('/api/data/artifacts/a1/cells.json');
  });
  it('rawScanRelPath는 스펙 §6.3 규약 그대로', () => {
    expect(rawScanRelPath('s1', 'c1', 'ply')).toBe('raw-scans/s1/c1/raw.ply');
  });
});

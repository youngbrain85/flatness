import { describe, expect, it } from 'vitest';
import path from 'path';
import { contentTypeFor, resolveDataPath } from '../data-files';

const DATA = path.resolve('testdata');

describe('resolveDataPath (경로 탈출 차단)', () => {
  it('허용 루트의 정상 경로는 DATA_DIR 아래 절대경로로 결합한다', () => {
    const abs = resolveDataPath(DATA, ['artifacts', 'a1', 'stats.json']);
    expect(abs).toBe(path.join(DATA, 'artifacts', 'a1', 'stats.json'));
  });
  it('허용 루트(raw-scans/artifacts/reports) 밖은 거부한다', () => {
    expect(resolveDataPath(DATA, ['etc', 'passwd'])).toBeNull();
    expect(resolveDataPath(DATA, ['artifacts'])).toBeNull(); // 루트 단독(파일 아님)도 거부
  });
  it('.. 세그먼트·백슬래시·빈 세그먼트를 거부한다', () => {
    expect(resolveDataPath(DATA, ['artifacts', '..', '..', 'secret.txt'])).toBeNull();
    expect(resolveDataPath(DATA, ['artifacts', 'a\\b', 'x.png'])).toBeNull();
    expect(resolveDataPath(DATA, ['artifacts', '', 'x.png'])).toBeNull();
  });
  it('세그먼트에 임베드된 트래버설(인코딩 슬래시 우회)을 거부한다', () => {
    // Next.js는 %2f를 세그먼트 경계로 취급하지 않고 디코딩만 하므로
    // params.path에 '../secret.txt' 같은 단일 세그먼트가 들어올 수 있다(리뷰 Critical)
    expect(resolveDataPath(DATA, ['artifacts', '../secret.txt'])).toBeNull();
    expect(resolveDataPath(DATA, ['artifacts', 'a/b.txt'])).toBeNull(); // 슬래시 포함 세그먼트
    expect(resolveDataPath(DATA, ['artifacts', 'a\0b.txt'])).toBeNull(); // NUL 포함
    expect(resolveDataPath(DATA, ['artifacts', 'abc', 'stats.json'])).toBe(
      path.join(DATA, 'artifacts', 'abc', 'stats.json'),
    ); // 정상 케이스는 그대로 통과
  });
});

describe('contentTypeFor', () => {
  it('확장자별 content-type', () => {
    expect(contentTypeFor('a.png')).toBe('image/png');
    expect(contentTypeFor('a.json')).toBe('application/json');
    expect(contentTypeFor('a.csv')).toBe('text/csv; charset=utf-8');
    expect(contentTypeFor('a.bin')).toBe('application/octet-stream');
  });
});

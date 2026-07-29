import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { dirSizeBytes, fmtBytes } from '../disk-usage';

describe('dirSizeBytes / fmtBytes (홈 저장 용량 표시 - 스펙 §3.3)', () => {
  it('하위 디렉터리 포함 파일 크기를 합산한다', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'du-'));
    await fs.writeFile(path.join(dir, 'a.txt'), 'abcd');
    await fs.mkdir(path.join(dir, 'sub'));
    await fs.writeFile(path.join(dir, 'sub', 'b.txt'), 'ef');
    expect(await dirSizeBytes(dir)).toBe(6);
  });
  it('없는 디렉터리는 0', async () => {
    expect(await dirSizeBytes(path.join(os.tmpdir(), 'du-none-없음'))).toBe(0);
  });
  it('fmtBytes는 사람이 읽는 단위', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(1536)).toBe('1.5 KB');
    expect(fmtBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(fmtBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
  });
});

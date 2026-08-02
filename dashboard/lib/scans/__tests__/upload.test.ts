import { describe, expect, it } from 'vitest';
import { storageErrorMessage, uploadRawScan } from '../upload';

function stubSupabase(uploadError: unknown = null) {
  const calls: { bucket?: string; key?: string; upsert?: boolean } = {};
  const supabase = {
    storage: {
      from: (bucket: string) => ({
        upload: async (key: string, _file: File, opts?: { upsert?: boolean }) => {
          calls.bucket = bucket;
          calls.key = key;
          calls.upsert = opts?.upsert;
          return { error: uploadError };
        },
      }),
    },
  };
  return { supabase, calls };
}

describe('uploadRawScan (lib/photos/upload.ts 패턴 확장)', () => {
  it('raw-scans 버킷의 규약 키로 업로드하고 rel_path를 반환한다', async () => {
    const { supabase, calls } = stubSupabase();
    const file = new File(['x'], 'scan.ply');
    const rel = await uploadRawScan(supabase as never, file, 'site1', 'scan1', 'ply');
    expect(rel).toBe('raw-scans/site1/scan1/raw.ply');
    expect(calls.bucket).toBe('raw-scans');
    expect(calls.key).toBe('site1/scan1/raw.ply'); // 버킷 접두 제거
    expect(calls.upsert).toBe(true);
  });
  it('Storage 오류를 한국어로 번역해 던진다', async () => {
    const { supabase } = stubSupabase(new Error('The object exceeded the maximum allowed size'));
    const file = new File(['x'], 'scan.ply');
    await expect(uploadRawScan(supabase as never, file, 'site1', 'scan1', 'ply'))
      .rejects.toThrow('저장소 한도를 초과');
  });
});

describe('storageErrorMessage (Storage 오류 한국어 번역)', () => {
  it('용량 초과 오류를 한국어로 번역한다', () => {
    expect(storageErrorMessage(new Error('The object exceeded the maximum allowed size')))
      .toContain('저장소 한도를 초과');
    expect(storageErrorMessage(new Error('Payload too large'))).toContain('저장소 한도를 초과');
  });
  it('할당량 초과 오류를 한국어로 번역한다', () => {
    expect(storageErrorMessage(new Error('exceeded storage quota'))).toContain('저장소 용량이 가득');
  });
  it('그 외 오류는 원문을 포함해 안내한다', () => {
    expect(storageErrorMessage(new Error('network down'))).toContain('network down');
  });
});

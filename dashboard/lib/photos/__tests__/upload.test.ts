import { describe, expect, it } from 'vitest';
import { uploadPhoto } from '../upload';

function stubSupabase() {
  const calls: { storageKey?: string; inserted?: Record<string, unknown> } = {};
  const supabase = {
    storage: {
      from: (bucket: string) => ({
        upload: async (key: string) => {
          calls.storageKey = `${bucket}/${key}`;
          return { error: null };
        },
      }),
    },
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        calls.inserted = row;
        return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
      },
    }),
  };
  return { supabase, calls };
}

describe('uploadPhoto', () => {
  it('Storage 업로드 후 photos 행을 참조 1개와 함께 insert한다', async () => {
    const { supabase, calls } = stubSupabase();
    const file = new File(['x'], 'field.jpg', { type: 'image/jpeg' });
    const row = await uploadPhoto(supabase as never, file, { scan_id: 's1' }, '벽면 근접');
    expect(calls.storageKey).toMatch(/^photos\/[0-9a-f-]+\.jpg$/);
    expect(calls.inserted?.scan_id).toBe('s1');
    expect(calls.inserted?.caption).toBe('벽면 근접');
    expect(String(calls.inserted?.file_path)).toMatch(/^photos\/[0-9a-f-]+\.jpg$/);
    expect(row.file_path).toBe(calls.inserted?.file_path);
  });
  it('지원하지 않는 형식은 예외', async () => {
    const { supabase } = stubSupabase();
    const file = new File(['x'], 'a.exe');
    await expect(uploadPhoto(supabase as never, file, { site_id: 's1' })).rejects.toThrow('지원하지 않는');
  });
});

import { describe, expect, it } from 'vitest';
import { ensureProfile } from '../ensure-profile';

// profiles 조회/삽입 체인만 흉내내는 최소 스텁
function stub(existing: { id: string; display_name: string } | null) {
  const calls: { inserted?: Record<string, unknown> } = {};
  const client = {
    from() {
      return {
        select() {
          return { eq() { return { maybeSingle: async () => ({ data: existing, error: null }) }; } };
        },
        insert(row: Record<string, unknown>) {
          calls.inserted = row;
          return {
            select() {
              return { single: async () => ({ data: { id: row.id, display_name: row.display_name }, error: null }) };
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

describe('ensureProfile', () => {
  it('기존 프로필이 있으면 그대로 반환하고 insert하지 않는다', async () => {
    const { client, calls } = stub({ id: 'u1', display_name: '홍길동' });
    const p = await ensureProfile(client as never, { id: 'u1', email: 'a@b.c' });
    expect(p.display_name).toBe('홍길동');
    expect(calls.inserted).toBeUndefined();
  });

  it('프로필이 없으면 이메일 앞부분을 display_name으로 insert한다(id, display_name 2컬럼만)', async () => {
    const { client, calls } = stub(null);
    const p = await ensureProfile(client as never, { id: 'u2', email: 'young@x.com' });
    expect(calls.inserted).toEqual({ id: 'u2', display_name: 'young' });
    expect(p.display_name).toBe('young');
  });

  it('이메일이 없으면 "사용자"를 기본 이름으로 쓴다', async () => {
    const { client, calls } = stub(null);
    await ensureProfile(client as never, { id: 'u3', email: null });
    expect(calls.inserted).toEqual({ id: 'u3', display_name: '사용자' });
  });
});

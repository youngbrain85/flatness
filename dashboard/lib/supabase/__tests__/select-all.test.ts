// Supabase(PostgREST)는 한 번에 최대 행 수(기본 1000)만 돌려주고 넘치는 행은 오류 없이 잘라 낸다.
// 또 .in() 에 id 를 수백 개 넣으면 GET 주소가 길어져 막힌다. selectAll·selectIn 이 둘을 막는다.
import { describe, expect, it, vi } from 'vitest';
import { IN_CHUNK, PAGE_ROWS, selectAll, selectIn } from '../select-all';

// rows 를 from..to 로 잘라 주는 가짜 조회(PostgREST range 와 같이 양 끝 포함)
const pager = (rows: number[]) => vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }));

describe('selectAll', () => {
  it('한 쪽이 가득 차면(PAGE_ROWS) 다음 쪽을 이어 받고, 덜 찬 쪽에서 멈춘다', async () => {
    const rows = Array.from({ length: PAGE_ROWS * 2 + 5 }, (_, i) => i);
    const page = pager(rows);
    const r = await selectAll(page);
    expect(r.error).toBeNull();
    expect(r.data).toEqual(rows);
    expect(page.mock.calls).toEqual([[0, PAGE_ROWS - 1], [PAGE_ROWS, PAGE_ROWS * 2 - 1], [PAGE_ROWS * 2, PAGE_ROWS * 3 - 1]]);
  });

  it('행이 꼭 PAGE_ROWS 개면 빈 쪽을 한 번 더 확인하고 멈춘다', async () => {
    const page = pager(Array.from({ length: PAGE_ROWS }, (_, i) => i));
    const r = await selectAll(page);
    expect(r.data).toHaveLength(PAGE_ROWS);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it('어느 쪽에서든 오류가 나면 그 오류를 돌려주고 멈춘다(반쪽 결과를 사실처럼 쓰지 않는다)', async () => {
    let n = 0;
    const page = vi.fn(async () => (++n === 2
      ? { data: null, error: { message: '연결 끊김' } }
      : { data: Array.from({ length: PAGE_ROWS }, (_, i) => i), error: null }));
    const r = await selectAll(page);
    expect(r).toEqual({ data: null, error: { message: '연결 끊김' } });
    expect(page).toHaveBeenCalledTimes(2);
  });
});

describe('selectIn', () => {
  it('id 를 IN_CHUNK 개씩 나눠 조회하고 결과를 순서대로 이어 붙인다', async () => {
    const ids = Array.from({ length: IN_CHUNK * 2 + 1 }, (_, i) => `id${i}`);
    const query = vi.fn(async (chunk: string[]) => ({ data: chunk.map((id) => ({ id })), error: null }));
    const r = await selectIn(ids, query);
    expect(r.data).toEqual(ids.map((id) => ({ id })));
    // 가짜 조회는 조각만 쓰지만 selectIn 은 (조각, from, to) 를 넘긴다
    expect((query.mock.calls as unknown as [string[], number, number][]).map(([chunk, from, to]) => [chunk.length, from, to]))
      .toEqual([[IN_CHUNK, 0, PAGE_ROWS - 1], [IN_CHUNK, 0, PAGE_ROWS - 1], [1, 0, PAGE_ROWS - 1]]);
  });

  it('조각 안에서도 쪽을 넘겨 받는다', async () => {
    const big = Array.from({ length: PAGE_ROWS + 3 }, (_, i) => i);
    const query = vi.fn(async (_chunk: string[], from: number, to: number) => ({ data: big.slice(from, to + 1), error: null }));
    const r = await selectIn(['a'], query);
    expect(r.data).toEqual(big);
  });

  it('조각 하나라도 실패하면 그 오류를 돌려준다', async () => {
    const ids = Array.from({ length: IN_CHUNK + 1 }, (_, i) => `id${i}`);
    const query = vi.fn(async (chunk: string[]) => (chunk.length === 1
      ? { data: null, error: { message: '거부' } }
      : { data: [], error: null }));
    expect(await selectIn(ids, query)).toEqual({ data: null, error: { message: '거부' } });
  });

  it('id 가 없으면 조회를 보내지 않고 빈 결과를 돌려준다(빈 .in() 금지)', async () => {
    const query = vi.fn();
    expect(await selectIn([], query)).toEqual({ data: [], error: null });
    expect(query).not.toHaveBeenCalled();
  });
});

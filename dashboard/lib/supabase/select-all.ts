// 목록 조회의 두 상한을 피한다.
// 1) Supabase(PostgREST)는 한 번에 최대 행 수(프로젝트 기본 1000)만 돌려주고, 넘치는 행은 오류 없이
//    잘라 낸다 - 처리 중 KPI·실패 할 일 같은 집계가 조용히 줄어든다. 쪽(range)을 넘겨 끝까지 받는다.
// 2) .in() 에 id 를 수백 개 넣으면 GET 주소가 길어져 요청이 막힌다. id 를 조각내 나눠 묻는다.
// 쪽을 넘기는 조회는 순서가 고정돼야 행이 빠지거나 겹치지 않으므로 호출부가 .order('id') 를 건다.
// 가정: 프로젝트의 API "Max rows" 가 PAGE_ROWS 이상이다(기본 1000). 그보다 낮추면 첫 쪽이 덜 찬 것으로
// 보여 여기서 멈추므로, 그 설정을 바꿀 때는 PAGE_ROWS 도 함께 낮춘다.

export const PAGE_ROWS = 1000;
export const IN_CHUNK = 150;

type Result<T> = { data: T[] | null; error: { message: string } | null };

/** page(from, to)(양 끝 포함)를 덜 찬 쪽이 나올 때까지 불러 이어 붙인다. 오류가 나면 그 오류만 돌려준다. */
export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<Result<T>>,
): Promise<Result<T>> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) return { data: null, error };
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_ROWS) return { data: out, error: null };
  }
}

/** ids 를 IN_CHUNK 개씩 나눠 query(조각, from, to)로 끝까지 받아 이어 붙인다. ids 가 비면 묻지 않는다. */
export async function selectIn<T>(
  ids: string[],
  query: (chunk: string[], from: number, to: number) => PromiseLike<Result<T>>,
): Promise<Result<T>> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const r = await selectAll<T>((from, to) => query(chunk, from, to));
    if (r.error) return r;
    out.push(...(r.data ?? []));
  }
  return { data: out, error: null };
}

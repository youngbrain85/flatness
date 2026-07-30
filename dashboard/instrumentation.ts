// 서버 기동 시 1회 실행되는 초기화 훅 (Next.js instrumentation 규약).
//
// 목적: Supabase로 나가는 HTTP 연결을 오래 유지해 TLS 핸드셰이크 비용을 없앤다.
// 실측 근거(2026-07-29, 프로젝트 ehmhrdbgaeinrpsrebxt):
//   - 새 연결마다 TLS 핸드셰이크에 3.1초 소요(같은 PC에서 google/github은 0.3초)
//   - 같은 연결 재사용 시 26~31ms (약 100배 차이)
//   - Node 기본 커넥션 풀은 유휴 연결을 수 초 만에 닫아, 페이지를 옮길 때마다
//     핸드셰이크를 다시 치르며 proxy.ts(세션 확인)만으로 매 요청 3.3초가 들었다
// 따라서 유휴 연결 유지 시간을 늘려 페이지 이동 사이에 연결이 살아있게 한다.
export async function register() {
  // Edge 런타임에는 undici 디스패처 개념이 없다 - Node 런타임에서만 설정한다.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { setGlobalDispatcher, Agent } = await import('undici');
  setGlobalDispatcher(
    new Agent({
      keepAliveTimeout: 60_000, // 유휴 연결 유지 60초
      keepAliveMaxTimeout: 600_000, // 서버가 더 긴 유지를 허용하면 최대 10분까지
    }),
  );
}

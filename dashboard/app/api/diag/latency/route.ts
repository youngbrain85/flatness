// 임시 진단 엔드포인트 - Vercel 함수(서버)에서 Supabase까지의 왕복을 직접 잰다.
// 화면 전환 지연의 잔여 원인이 "함수 리전 ↔ Supabase 리전 거리"인지 판별하기 위한 것.
// 로그인 사용자만 접근 가능하며, 측정이 끝나면 제거한다.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

async function timeIt(fn: () => Promise<unknown>, n = 3): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = Date.now();
    try { await fn(); } catch { /* 실패해도 왕복 시간은 유효하다 */ }
    out.push(Date.now() - s);
  }
  return out;
}

export async function GET() {
  const supabase = await createClient();
  // /api/*는 proxy matcher 밖이라 여기서 직접 인증한다(기존 route.ts와 같은 규약)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const authMs = await timeIt(() => fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store',
  }));
  const restMs = await timeIt(() => fetch(`${url}/rest/v1/sites?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store',
  }));
  // supabase 쿼리 빌더는 PromiseLike라 Promise 시그니처에 그대로 넣을 수 없다 - await로 감싼다
  const queryMs = await timeIt(async () => { await supabase.from('reports').select('id').limit(1); });

  return NextResponse.json({
    region: process.env.VERCEL_REGION ?? 'unknown',
    authMs, restMs, queryMs,
  }, { headers: { 'cache-control': 'no-store' } });
}

// <title> 규약(스펙 §9, 공유 계약): 루트 layout(Task 1)의 template 'Flatness · %s'가 각 page.tsx의
// `export const metadata = { title: '<화면 이름>' }` 앞에 붙는다(루트 template 자체는 app/__tests__/layout.test.tsx가 지킨다).
// app/page.tsx는 루트 layout과 같은 세그먼트라 template이 붙지 않으므로 전체 문자열 'Flatness · 현장 목록'을 준다
// (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md 의 title.template 절).
// 페이지 모듈을 import하면 Supabase·next/headers 의존이 딸려 오므로 소스를 읽는다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..'); // dashboard/
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quoted = (t: string) => `'${esc(t)}'`;

/** `export const metadata(: Metadata)? = { … title: <값> … };` 꼴인지 본다(다른 키가 함께 있어도 된다).
 *  [^;]*?가 범위를 metadata 문장 안(첫 ;까지)으로 묶는다 - 다른 객체의 title: 은 보지 않는다. */
function hasTitle(src: string, valuePattern: string): boolean {
  return new RegExp(`export const metadata(?::\\s*Metadata)?\\s*=\\s*\\{[^;]*?\\btitle:\\s*${valuePattern}`).test(src);
}

const ENTRY_TITLE = 'Flatness · 현장 목록';

// 화면 이름표(계약). 담당 태스크가 metadata를 넣는다 - 빠졌으면 Task 12 Step 8이 넣는다.
const PAGES: [file: string, title: string][] = [
  ['app/login/page.tsx', '로그인'], // Task 11
  ['app/sites/[id]/page.tsx', '현장 대시보드'], // Task 4
  ['app/sites/[id]/locations/page.tsx', '측정위치'], // Task 5
  ['app/sites/[id]/upload/page.tsx', '스캔 업로드'], // Task 6
  ['app/sites/[id]/reports/page.tsx', '보고서'], // Task 10
  ['app/scans/[id]/page.tsx', '스캔'], // Task 7
  ['app/registrations/new/page.tsx', '스캔 정합 시작'], // Task 9
  ['app/registrations/[id]/page.tsx', '스캔 정합'], // Task 9
  ['app/reports/new/page.tsx', '보고서 생성'], // Task 10
  ['app/reports/[id]/page.tsx', '보고서 상세'], // Task 10
  ['app/settings/page.tsx', '설정'], // Task 11
];

describe('<title> 규약 (스펙 §9)', () => {
  it('진입 페이지(/)는 template 없이 전체 제목을 준다(문자열 또는 absolute)', () => {
    const value = `(?:${quoted(ENTRY_TITLE)}|\\{\\s*absolute:\\s*${quoted(ENTRY_TITLE)}\\s*\\})`;
    expect(hasTitle(read('app/page.tsx'), value)).toBe(true);
  });

  it.each(PAGES)('%s 의 화면 이름은 "%s"(앞의 "Flatness · "는 루트 template이 붙인다)', (file, title) => {
    expect(hasTitle(read(file), quoted(title))).toBe(true);
  });

  it('검사 함수 자체: 다른 문장의 title·접두어 붙은 이름은 통과시키지 않고, 여러 줄(CRLF) 객체는 읽는다', () => {
    expect(hasTitle("export const metadata = { description: 'x' };\nconst t = { title: '설정' };", quoted('설정'))).toBe(false);
    expect(hasTitle("export const metadata = { title: 'Flatness · 설정' };", quoted('설정'))).toBe(false);
    expect(hasTitle("export const metadata = { title: '보고서 상세' };", quoted('보고서'))).toBe(false);
    expect(hasTitle("export const metadata: Metadata = {\r\n  title: '설정',\r\n};", quoted('설정'))).toBe(true);
  });
});

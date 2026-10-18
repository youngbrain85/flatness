// Tailwind 스캐너 사각지대 가드(Task 12 정적 대조에서 발견).
// Tailwind v4 는 소스 글자에서 클래스 후보를 뽑는데, 템플릿 보간 바로 앞에 붙은 글자는 후보로 뽑지 않는다
// (@tailwindcss/oxide 4.3.3 실측: `px-5 py-[18px]${x}` 에서 px-5 는 뽑고 py-[18px] 는 못 뽑는다. bg-surface·pt-5·
// last:border-b-0·text-[13px] 도 붙어 있으면 못 뽑는다). 그 클래스를 다른 파일이 띄어 쓰지 않았으면 CSS 규칙이 생성되지
// 않아 화면에서 소리 없이 사라진다 - KpiCard 의 py-[18px] 가 그래서 KPI 카드 위아래 여백이 0 이었다
// (next build CSS 에 규칙 없음, 1440·390 캡처에서 숫자가 카드 아래 테두리에 붙음).
// 그래서 클래스처럼 생긴 글자를 템플릿 보간 바로 앞에 붙이지 않는다: 'a b' + (조건 ? ' c' : '') 처럼 따옴표로 끝낸다.
// 저장소는 core.autocrlf=true 라 줄은 /\r?\n/ 으로 나눈다(palette-sweep.test.ts 와 같은 이유).
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '..'); // dashboard/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (f: string) => relative(ROOT, f).split(sep).join('/');
/** 화면 코드: __tests__ 밖의 ts·tsx */
const screenTs = () => ['app', 'components', 'lib'].flatMap((d) => walk(join(ROOT, d)))
  .filter((f) => !f.split(sep).includes('__tests__'));

/** 주석을 지운 줄(줄 번호 보존) - palette-sweep.test.ts 의 codeLines 와 같은 규칙 */
function codeLines(src: string): string[] {
  const noBlock = src.replace(/(^|[\s{(])\/\*[\s\S]*?\*\//g,
    (m: string, pre: string) => pre + m.slice(pre.length).replace(/[^\n]/g, ''));
  return noBlock.split(/\r?\n/).map((line) => line.replace(/(^|[\s{(;,])\/\/.*$/, '$1'));
}

// 보간 바로 앞에 붙은 글자 덩어리(공백·따옴표·중괄호·$ 가 아닌 글자들)
const GLUED = /([^\s`'"{}$]+)\$\{/g;
// 클래스처럼 생긴 글자: 변형(sm: · last: · aria-expanded: …) 뒤에 유틸리티 하나 - 이름(-조각)* 또는 [임의 속성].
// 조각은 글자·숫자·소수점, 분수(/50), [임의값]. '-'·'/' 로 끝나는 주소·id 조각(loc- · /sites/)과 기호는 맞지 않는다.
const CLASS_LIKE = /^(?:[a-z0-9-]+:)*!?-?(?:[a-z][a-z0-9]*(?:-(?:[a-z0-9.]+|\[[^\]\s]+\]))*(?:\/[a-z0-9.]+)?|\[[^\]\s]+\])$/;

function gluedClasses(src: string): { line: number; token: string }[] {
  const found: { line: number; token: string }[] = [];
  codeLines(src).forEach((line, i) => {
    for (const m of line.matchAll(GLUED)) {
      if (CLASS_LIKE.test(m[1])) found.push({ line: i + 1, token: m[1] });
    }
  });
  return found;
}

describe('규칙 자체 점검 - 붙은 클래스는 잡고 주소·id·기호는 놓아준다', () => {
  const FORBIDDEN: [sample: string, token: string][] = [
    ['className={`flex px-5 py-[18px]${className ? ` ${className}` : \'\'}`}', 'py-[18px]'],
    ['`flex flex-col bg-surface${padded ? \'\' : \' overflow-hidden\'}`', 'bg-surface'],
    ['`px-4 last:border-b-0${blocked ? \' gap-2\' : \'\'}`', 'last:border-b-0'],
    ['`font-mono text-[13px]${blocked ? \'\' : \' text-ink-2\'}`', 'text-[13px]'],
    ['`relative${className ? ` ${className}` : \'\'}`', 'relative'],
    ['`min-w-0 [overflow-wrap:anywhere]${x}`', '[overflow-wrap:anywhere]'],
    ['`sm:w-1/2${x}`', 'sm:w-1/2'],
  ];
  it.each(FORBIDDEN)('"%s" 에서 %s 를 잡는다', (sample, token) => {
    expect(gluedClasses(sample).map((h) => h.token)).toEqual([token]);
  });

  const ALLOWED = [
    'href={`/sites/${siteId}/reports?location=${l.id}`}',
    'id={`loc-${l.id}`} aria-labelledby={`bld-${bi}`}',
    '`${wall.length_m} x ${wall.height_m}` `rgba(${r}, ${g}, ${b}, 0.5)` `±${v}` `×${k}`',
    '`id=eq.${id}` `photos/${p}` `raw-scans/${s}/${id}/raw.${ext}` `report_failed:${id}`',
    "'flex px-5 py-[18px]' + (className ? ` ${className}` : '')",
    '`flex ${cond ? \'a\' : \'b\'}` `${a}${b}`',
    '// 주석 속 `py-[18px]${x}` 는 화면 코드가 아니다',
  ];
  it.each(ALLOWED)('"%s" 는 잡지 않는다', (sample) => {
    expect(gluedClasses(sample)).toEqual([]);
  });
});

describe('Tailwind 스캐너가 못 보는 클래스 (Task 12)', () => {
  it('화면 코드에 템플릿 보간 바로 앞에 붙은 Tailwind 클래스가 없다(붙으면 CSS 규칙이 생성되지 않을 수 있다)', () => {
    const hits = screenTs().flatMap((f) => gluedClasses(readFileSync(f, 'utf8')).map((h) => `${rel(f)}:${h.line}: ${h.token}`));
    expect(hits).toEqual([]);
  });

  it('검사 범위가 비지 않는다(공통 부품·화면 파일이 들고 테스트 파일은 빠진다)', () => {
    const files = screenTs().map(rel);
    for (const f of ['components/ui/kpi.tsx', 'components/ui/container.tsx', 'app/scans/[id]/page.tsx']) {
      expect(files).toContain(f);
    }
    expect(files.some((f) => f.includes('/__tests__/'))).toBe(false);
  });
});

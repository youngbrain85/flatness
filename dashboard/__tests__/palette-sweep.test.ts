// 팔레트·테마·옛 경로 잔재 가드(스펙 §3 "이 표 밖의 색은 쓰지 않는다"·테마 분기 없음, §4.2 옛 경로, §9 em dash 금지).
// app·components·lib를 줄 단위로 읽어 어긴 곳을 `파일:줄: 내용`으로 모은다.
// 검사 범위는 둘이다.
//  - 화면 코드(__tests__ 밖의 ts·tsx·css): 이 태스크가 더한 규칙 전부. 테스트 파일은 뺀다 - "cs- 가 없다" 같은
//    부정 단언과 "엔진 hex 를 쓰지 않는다" 테스트(palette.test·heatmap.test·slope-heatmap.test)는 그 글자를 담아야 한다.
//  - 테스트 포함 ts·tsx: Task 1이 지키던 옛 팔레트 단계 클래스 검사(그대로 잇는다).
// Task 1의 '다크 토큰 가드'(공통 부품·palette.ts·layout.tsx 한정)는 아래 화면 코드 전체 규칙이 넓혀 대신한다.
// 엔진 hex 는 값 목록을 여기 직접 적는다: 구배 표(SLOPE_GRADE_COLOR)는 Task 12가 지웠고, 평활도 PDF 색(GRADE_COLOR)은
// labels.ts 에 워커 대조용 참조표로만 남는다(화면 코드는 import 하지 않는다 - 아래 규칙이 지킨다).
// 이 파일은 dashboard/__tests__에 있어 검사 대상(app·components·lib)에 들지 않는다.
// 저장소는 core.autocrlf=true라 작업 트리 파일이 CRLF다 - 줄은 /\r?\n/으로 나눈다('\n'으로 나누면 줄 끝 \r 때문에
// 주석 지우기 정규식의 `.*$`가 맞지 않아 주석이 코드로 남는다 - 실측).
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// vitest는 __dirname을 준다. import.meta.url은 file: 스킴이 아니라 fileURLToPath가 던진다(실측).
const ROOT = join(__dirname, '..'); // dashboard/
const SCAN_DIRS = ['app', 'components', 'lib'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (f: string) => relative(ROOT, f).split(sep).join('/');
const isTest = (f: string) => f.split(sep).includes('__tests__');
const isTs = (f: string) => /\.(ts|tsx)$/.test(f);
const allFiles = () => SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
/** 테스트 포함 ts·tsx(Task 1 옛 팔레트 검사 범위) */
const tsWithTests = () => allFiles().filter(isTs);
/** 화면 코드: __tests__ 밖의 ts·tsx·css */
const screenFiles = () => allFiles().filter((f) => !isTest(f));
const screenTs = () => screenFiles().filter(isTs);

/** 주석을 지운 줄(줄 번호 보존). 블록 주석(여러 줄 포함)과, 줄 처음·공백·{·(·;·, 뒤에서 시작하는 // 줄 주석만
 *  지운다 - 'https://' 같은 문자열 속 //는 앞 글자가 ':'라 남고, accept="image/*" 같은 문자열 속 /*도 남는다. */
function codeLines(src: string): string[] {
  const noBlock = src.replace(/(^|[\s{(])\/\*[\s\S]*?\*\//g,
    (m: string, pre: string) => pre + m.slice(pre.length).replace(/[^\n]/g, ''));
  return noBlock.split(/\r?\n/).map((line) => line.replace(/(^|[\s{(;,])\/\/.*$/, '$1'));
}

type Rule = { re: RegExp; allow?: ReadonlySet<string>; code?: boolean };

function hits(files: string[], rule: Rule): string[] {
  const found: string[] = [];
  for (const file of files) {
    const r = rel(file);
    if (rule.allow?.has(r)) continue;
    const src = readFileSync(file, 'utf8');
    const lines = rule.code ? codeLines(src) : src.split(/\r?\n/);
    lines.forEach((line, i) => {
      const m = line.match(rule.re);
      if (m) found.push(`${r}:${i + 1}: ${m[0]}`);
    });
  }
  return found;
}

// 1) 옛 Tailwind 팔레트 단계 클래스. 색 이름 앞의 \b 덕에 -translate-x-1/2 같은 부분 문자열은 잡히지 않는다.
//    앞뒤 [\w:/-]*는 표시용 - 실패 메시지에 hover:bg-zinc-700처럼 클래스 전체가 찍힌다.
//    OLD_PALETTE_T1은 Task 1이 테스트까지 지키던 색 목록 그대로, OLD_PALETTE는 화면 코드에 거는 전체 색 이름이다.
const OLD_PALETTE_T1 = /[\w:/-]*\b(zinc|amber|red|green|emerald|purple|blue)-[0-9]{2,3}\b[\w/]*/;
const OLD_PALETTE = /[\w:/-]*\b(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\b[\w/]*/;
// 2) 흰색·검정 유틸리티와 임의값 hex 색 클래스 - 색은 토큰 클래스로만(아트보드 hex → 토큰, Global Constraints)
const UTIL = '(?:bg|text|border|ring|outline|fill|stroke|from|via|to|accent|decoration|divide|placeholder|caret|shadow)';
const WHITE_BLACK = new RegExp(`(?<![\\w-])${UTIL}-(?:white|black)\\b`);
const ARBITRARY_HEX = new RegExp(`(?<![\\w-])${UTIL}-\\[#[0-9a-fA-F]{3,8}\\]`);
// 3) cs-* 토큰(Cloudscape). globals.css 정의·클래스·주석까지 0이어야 한다
const CS_TOKEN = /(?<![A-Za-z0-9_])cs-[a-z][\w-]*/;
// 4) 옛 Cloudscape 토큰 hex
const OLD_HEX = /#(?:000716|5f6b7a|414d5c|0972d3|033160|e9ebed|8c8c94|9ba7b6|0f1b2a|d1d5db|037f0c|f2fcf3|8d6605|fffce9|d91515|fff7f7|f2f8fd|7d8998|7d2f9e|f5f0fa)\b/i;
// 3D 뷰어 '밝은 배경'(스펙 §10 3D 뷰어 로직 무변경)이 데이터 색으로 쓰는 값 - 화면 토큰이 아니다
const OLD_HEX_ALLOWED: ReadonlySet<string> = new Set(['lib/domain/points3d.ts']);
// 5) 엔진 hex: PDF 등급 색(labels.ts GRADE_COLOR = 워커 report/labels.py) #2e7d32 #f9ab00 #e8710a #c5221f #9e9e9e,
//    엔진 구배 PNG 색(engine/flatness/outputs/slope_map.py _COLOR) #3d8b3d #d6c11e #e07b1a #c0392b, 엔진 배수구 #1a73e8.
//    화면은 lib/domain/palette.ts 의 화면 색만 쓴다(스펙 §3). 예외는 참조표 선언 파일 하나다.
const ENGINE_HEX = /#(?:2e7d32|f9ab00|e8710a|c5221f|9e9e9e|3d8b3d|d6c11e|e07b1a|c0392b|1a73e8)\b/i;
// GRADE_COLOR 선언(워커 worker/tests/test_report_labels.py 가 파싱해 대조하는 PDF·엔진 참조표 - 워커는 바꾸지 않는다)
const PDF_REFERENCE: ReadonlySet<string> = new Set(['lib/domain/labels.ts']);
// 6) GRADE_COLOR 는 선언 파일 밖의 화면 코드가 쓰지 않는다(import·사용 0). 주석 속 언급은 허용한다 - 남아 있는 표다.
const GRADE_COLOR_USE = /\bGRADE_COLOR\b/;
// 7) 지운 표 이름(Task 12 Step 6): 화면 코드 어디에도(주석 포함) 남지 않는다 - 남은 언급은 지금 사실과 다른 설명이다.
//    SCREEN_GRADE_COLOR·SCREEN_SLOPE_GRADE_COLOR·SLOPE_GRADE_TO_GRADE 는 단어 경계가 달라 잡히지 않는다.
const DELETED_NAME = /\b(?:SLOPE_GRADE_COLOR|SLOPE_GRADE_TONE)\b/;
// 8) 테마 분기: Tailwind dark: 변형과 prefers-color-scheme(스펙 §3 테마 분기 없음). globals.css의
//    `color-scheme: dark;`(브라우저 부품을 어둡게)와 points3d.ts의 객체 키 `dark: {`는 콜론 뒤가 달라 잡히지 않는다.
const DARK_VARIANT = /(?<![\w-])dark:(?=[\w[(!-])/;
const PREFERS_SCHEME = /prefers-color-scheme/;
// 9) 화면 글자의 em dash(U+2014). 문자 자체를 이 파일에 적지 않으려고 코드 값으로 만든다
const EM_DASH = new RegExp(String.fromCharCode(0x2014));
// 10) 옛 경로 링크: 리다이렉트만 남은 /reports(옛 전체 목록)·/upload·/sites/new 로 가는 문자열(스펙 §4.2, Task 2).
//    /reports/new·/reports/<id>·/sites/<id>/reports·/sites/<id>/upload 는 잡히지 않는다.
const STALE_ROUTE = /['"`]\/(?:reports|upload)(?=[?'"`])|['"`]\/sites\/new(?=[?'"`/])/;

const RULES: Record<string, RegExp> = {
  OLD_PALETTE_T1, OLD_PALETTE, WHITE_BLACK, ARBITRARY_HEX, CS_TOKEN, OLD_HEX, ENGINE_HEX,
  GRADE_COLOR_USE, DELETED_NAME, DARK_VARIANT, PREFERS_SCHEME, EM_DASH, STALE_ROUTE,
};

describe('규칙 자체 점검 (Task 12) - 정규식이 잡을 것과 놓아줄 것', () => {
  const FORBIDDEN: [rule: string, sample: string][] = [
    ['OLD_PALETTE_T1', 'hover:bg-zinc-700'],
    ['OLD_PALETTE', 'text-slate-500'],
    ['WHITE_BLACK', 'bg-white'],
    ['WHITE_BLACK', 'hover:text-black'],
    ['ARBITRARY_HEX', 'bg-[#0a0d1c]'],
    ['CS_TOKEN', 'text-cs-text-secondary'],
    ['CS_TOKEN', '  --color-cs-link: #0972d3;'],
    ['CS_TOKEN', 'rounded-b-cs-container'],
    ['OLD_HEX', "line: '#000716',"],
    ['ENGINE_HEX', "pass: '#2E7D32',"],
    ['ENGINE_HEX', "적합: '#3d8b3d',"],
    ['ENGINE_HEX', "const DRAIN_COLOR = '#1a73e8';"],
    ['GRADE_COLOR_USE', "import { GRADE_COLOR } from '@/lib/domain/labels';"],
    ['GRADE_COLOR_USE', 'ctx.fillStyle = GRADE_COLOR[c.grade];'],
    ['DELETED_NAME', 'SLOPE_GRADE_COLOR.적합'],
    ['DELETED_NAME', 'SLOPE_GRADE_TONE[r.grade]'],
    ['DELETED_NAME', '// SLOPE_GRADE_COLOR(lib/domain/slope-heatmap.ts, 엔진 PNG와 같은 hex)는 캔버스·범례 전용이고,'],
    ['DARK_VARIANT', 'dark:bg-surface'],
    ['DARK_VARIANT', 'md:dark:text-ink'],
    ['PREFERS_SCHEME', '@media (prefers-color-scheme: dark) {'],
    ['EM_DASH', `'Flatness ${String.fromCharCode(0x2014)} 콘솔'`],
    ['STALE_ROUTE', 'href="/reports"'],
    ['STALE_ROUTE', 'href={`/reports?location=${l.id}`}'],
    ['STALE_ROUTE', 'href={`/upload?site=${s}&location=${l}`}'],
    ['STALE_ROUTE', 'href="/sites/new"'],
  ];
  it.each(FORBIDDEN)('%s 는 "%s"를 잡는다', (rule, sample) => {
    expect(RULES[rule].test(sample)).toBe(true);
  });

  const ALLOWED = [
    'focus-visible:-outline-offset-3', // 진입 목록 줄(overflow-hidden 목록 안쪽 포커스 외곽선, Task 3)
    '-translate-x-1/2 border-line-2 text-ink-2 bg-surface-2 min-h-11 py-3.5 gap-x-2.5',
    'bg-ground text-ink bg-stage bg-paper text-ground border-grade-rework accent-ink',
    '    color-scheme: dark;', // globals.css @layer base 의 html 규칙(단일 다크 팔레트, 분기가 아니다)
    '  dark: { ground: STAGE_BG },', // lib/domain/points3d.ts 테마 이름(객체 키)
    'SCREEN_GRADE_COLOR[g] SCREEN_SLOPE_GRADE_COLOR[g] SLOPE_GRADE_TO_GRADE',
    "'https://docs-site.example/x'",
    '#38d454 #fad647 #ff8c1f #ff332e #85817a #6fcdeb #0a0d1c #f2efe9 #000000 #ffffff',
    'href={`/reports/new?location=${id}`} href={`/reports/${r.id}`} href={`/sites/${s}/reports?location=${l}`}',
    "href={`/sites/${s}/upload?location=${l}`} redirect('/')",
  ];
  it.each(ALLOWED)('어느 규칙도 "%s"를 잡지 않는다', (sample) => {
    expect(Object.entries(RULES).filter(([, re]) => re.test(sample)).map(([name]) => name)).toEqual([]);
  });

  it('codeLines는 주석만 지우고 줄 번호를 지킨다(CRLF, 문자열 속 // 와 /* 는 남긴다)', () => {
    const src = [
      "const a = 'https://x.example/a'; // dark:bg-x",
      '/* prefers-color-scheme',
      '   여러 줄 주석 */ const b = 1;',
      '<input accept="image/*" />',
      '{/* bg-white */}<p className="text-ink" />',
    ].join('\r\n');
    expect(codeLines(src)).toEqual([
      "const a = 'https://x.example/a'; ",
      '',
      ' const b = 1;',
      '<input accept="image/*" />',
      '{}<p className="text-ink" />',
    ]);
  });
});

describe('팔레트·테마·옛 경로 잔재 스윕 (Task 12)', () => {
  it('옛 Tailwind 팔레트 단계 클래스가 0건이다(Task 1 검사, 테스트 포함)', () => {
    expect(hits(tsWithTests(), { re: OLD_PALETTE_T1 })).toEqual([]);
  });

  it('화면 코드에 Tailwind 기본 팔레트 단계 클래스가 0건이다(색 이름 전부)', () => {
    expect(hits(screenTs(), { re: OLD_PALETTE, code: true })).toEqual([]);
  });

  it('화면 코드에 흰색·검정 유틸리티와 임의값 hex 색 클래스가 없다(색은 토큰 클래스로만)', () => {
    expect(hits(screenTs(), { re: WHITE_BLACK, code: true })).toEqual([]);
    expect(hits(screenTs(), { re: ARBITRARY_HEX, code: true })).toEqual([]);
  });

  it('cs-* 토큰이 화면 코드 어디에도(globals.css 정의·클래스·주석) 없다', () => {
    expect(hits(screenFiles(), { re: CS_TOKEN })).toEqual([]);
  });

  it('옛 Cloudscape hex가 화면 코드에 없다(3D 뷰어 밝은 판의 데이터 색 제외)', () => {
    expect(hits(screenFiles(), { re: OLD_HEX, allow: OLD_HEX_ALLOWED, code: true })).toEqual([]);
  });

  it('화면 코드가 엔진 hex(PDF·엔진 PNG 색)를 쓰지 않는다(labels.ts 의 GRADE_COLOR 참조표 선언 제외)', () => {
    expect(hits(screenFiles(), { re: ENGINE_HEX, allow: PDF_REFERENCE, code: true })).toEqual([]);
  });

  it('GRADE_COLOR(워커 대조용 PDF·엔진 참조표)는 labels.ts 선언 밖의 화면 코드가 import·사용하지 않는다', () => {
    expect(hits(screenTs(), { re: GRADE_COLOR_USE, allow: PDF_REFERENCE, code: true })).toEqual([]);
  });

  it('지운 표(SLOPE_GRADE_COLOR·SLOPE_GRADE_TONE)의 이름이 화면 코드 어디에도(주석 포함) 없다', () => {
    expect(hits(screenFiles(), { re: DELETED_NAME })).toEqual([]);
  });

  it('dark: 변형과 prefers-color-scheme 분기가 없다(앱은 어두운 팔레트 하나)', () => {
    expect(hits(screenFiles(), { re: DARK_VARIANT, code: true })).toEqual([]);
    expect(hits(screenFiles(), { re: PREFERS_SCHEME, code: true })).toEqual([]);
  });

  it('화면 코드의 문자열·JSX 글자에 em dash가 없다(주석은 화면에 나오지 않아 제외)', () => {
    expect(hits(screenTs(), { re: EM_DASH, code: true })).toEqual([]);
  });

  it('옛 경로(/reports 전체 목록·/upload·/sites/new)로 가는 링크가 없다 - 현장 범위 주소를 쓴다', () => {
    expect(hits(screenTs(), { re: STALE_ROUTE, code: true })).toEqual([]);
  });

  it('지운 파일(Task 1 MetricCard·StatusDot, Task 2 옛 셸, Task 3 옛 홈 표·새 현장 폼)이 없고 어디서도 import하지 않는다', () => {
    const GONE = [
      'components/ui/metric-card.tsx', 'components/ui/status-dot.tsx',
      'components/shell/console-shell.tsx', 'components/shell/top-nav.tsx', 'components/shell/side-nav.tsx',
      'components/site-table.tsx', 'components/new-site-form.tsx',
    ];
    expect(GONE.filter((f) => existsSync(join(ROOT, f)))).toEqual([]);
    const GONE_IMPORT = /from '(?:@\/components\/|\.{1,2}\/)(?:[\w-]+\/)*(?:metric-card|status-dot|console-shell|top-nav|side-nav|site-table|new-site-form)'/;
    expect(tsWithTests().filter((f) => GONE_IMPORT.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
  });

  it('검사 범위가 비어 통과하지 않는다(화면 코드에 핵심 파일이 들고 테스트 파일은 빠진다)', () => {
    const screen = screenFiles().map(rel);
    for (const f of ['app/globals.css', 'app/layout.tsx', 'components/ui/grade.tsx', 'components/ui/stage.tsx',
      'lib/domain/palette.ts', 'app/sites/[id]/reports/page.tsx', 'app/scans/[id]/page.tsx']) {
      expect(screen).toContain(f);
    }
    expect(screen.some((f) => f.includes('/__tests__/'))).toBe(false);
    expect(tsWithTests().map(rel).some((f) => f.includes('/__tests__/'))).toBe(true);
  });
});

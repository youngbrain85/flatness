// 팔레트 잔재 가드(스펙 §3 "이 표 밖의 색을 쓰지 않는다" + §9-2의 기계 검증).
// 옛 Tailwind 팔레트 클래스가 app/components/lib에 하나라도 남으면 파일:줄과 함께 실패한다.
// __tests__도 검사 대상이다(옛 클래스 단언이 남았다면 스타일이 아니라 단언이 틀린 것).
// GRADE_COLOR(lib/domain/labels.ts)는 hex 문자열이라 이 정규식에 잡히지 않는다(스펙 §3 예외).
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// vitest는 __dirname을 준다. import.meta.url은 file: 스킴이 아니라 fileURLToPath가 던진다(실측).
const ROOT = join(__dirname, '..'); // dashboard/
const SCAN_DIRS = ['app', 'components', 'lib'];
// 색 이름 앞의 \b 덕에 -translate-x-1/2 같은 부분 문자열(2026-08-11 스윕의 false positive)은
// 잡히지 않는다. 앞뒤 [\w:/-]*는 표시용 - 실패 메시지에 hover:bg-zinc-700처럼 클래스 전체가 찍힌다.
const OLD_PALETTE = /[\w:/-]*\b(zinc|amber|red|green|emerald|purple|blue)-[0-9]{2,3}\b[\w/]*/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = () => SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
const rel = (f: string) => relative(ROOT, f).split(sep).join('/');

function paletteHits(): string[] {
  const found: string[] = [];
  for (const file of files()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(OLD_PALETTE);
      if (m) found.push(`${rel(file)}:${i + 1}: ${m[0]}`);
    });
  }
  return found;
}

describe('팔레트 잔재 스윕 (T12)', () => {
  it('app/components/lib(테스트 포함)에 옛 팔레트 클래스가 0건이다', () => {
    expect(paletteHits()).toEqual([]);
  });

  it('MetricCard·StatusDot 파일은 삭제됐고 어디서도 import하지 않는다', () => {
    expect(existsSync(join(ROOT, 'components/ui/metric-card.tsx'))).toBe(false);
    expect(existsSync(join(ROOT, 'components/ui/status-dot.tsx'))).toBe(false);
    const importers = files()
      .filter((f) => /ui\/(metric-card|status-dot)'/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(importers).toEqual([]);
  });
});

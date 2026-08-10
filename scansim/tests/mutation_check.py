"""scansim 변이 실험 — 테스트 스위트가 정말 회귀를 잡는지 스위트 자체를 시험한다.

이 프로젝트에서 "프로덕션 코드는 맞는데 테스트가 정작 막으려던 회귀를 못 잡는다"가
열두 번 반복됐다. 그래서 스위트의 성과 지표는 단언 개수가 아니라 **심은 변이를 몇 개
죽였는가**다.

세 가지를 지킨다:
1. **무변이 대조군을 먼저 돌린다** — 없으면 "전부 KILLED"가 게이트가 항상 실패하는
   상태와 구별되지 않는다 (세부과업 4에서 도구가 조용히 죽어 22건이 거짓 검출로 보고된
   사고가 실제로 있었다).
2. **변이가 실제로 적용됐는지 확인한다** — 패턴 미매치는 SURVIVED 가 아니라 '미적용'
   이며 실험 실패다.
3. 끝나면 전부 되돌리고 무변이 재확인.

실행: 저장소 루트에서 `python scansim/tests/mutation_check.py`
소요: 변이당 전체 scansim 스위트 1회 (~2.5분) × (변이 수 + 대조군 2회)
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# (이름, 파일, 원본 문자열, 변이 문자열) — 원본은 소스에서 그대로 복사(정확히 1회 매치 강제)
MUTATIONS = [
    ("커버 누적 최소→최대 (성긴 재관측이 촘촘한 기록을 덮는다)",
     "scansim/coverage.py",
     "np.minimum(self.spacing_mm, obs, out=self.spacing_mm)  # 최소 간격 누적",
     "np.maximum(self.spacing_mm, obs, out=self.spacing_mm)  # [변이] 최대"),
    ("레이캐스트가 장애물을 통과한다",
     "scansim/grid.py",
     "                return False",
     "                pass  # [변이] 차폐 무시"),
    ("가시성 스윕이 장애물 뒤를 본다",
     "scansim/coverage.py",
     "            out[s:e] = occ.free[iy, ix].all(axis=1)",
     "            out[s:e] = True  # [변이] 차폐 무시"),
    ("A* 가 장애물 셀로 확장한다",
     "scansim/grid.py",
     "                if not (0 <= mx < nx and 0 <= my < ny) or not free[my, mx]:",
     "                if not (0 <= mx < nx and 0 <= my < ny):  # [변이] 점유 무시"),
    ("미관측(inf) 셀을 커버로 집계한다",
     "scansim/coverage.py",
     "        covered = int((self.spacing_mm[free] <= target_mm).sum())",
     "        covered = int(((self.spacing_mm[free] <= target_mm) | ~np.isfinite(self.spacing_mm[free])).sum())  # [변이]"),
    ("TLS 계획 시간에서 거치 체류를 뺀다",
     "scansim/planner_tls.py",
     "    est_time = travel_len / cfg.mobile_speed_mms + cfg.tls_dwell_s * len(stations)",
     "    est_time = travel_len / cfg.mobile_speed_mms  # [변이] dwell 누락"),
    ("시뮬레이터 거치 체류 시간을 0으로 만든다",
     "scansim/simulate.py",
     "    dwell = float(cfg.tls_dwell_s)",
     "    dwell = 0.0  # [변이]"),
    ("로봇 반경 팽창을 무력화한다 (벽에 붙어 다닌다)",
     "scansim/grid.py",
     "        r = int(math.ceil(radius_mm / self.cell_mm - 1e-9))",
     "        r = 0  # [변이] 팽창 없음"),
    ("스윕 간격을 2배로 벌린다 (패스 사이 줄무늬 미커버)",
     "scansim/planner_mobile.py",
     "SWEEP_SPACING_FACTOR = 0.5",
     "SWEEP_SPACING_FACTOR = 1.0  # [변이]"),
    ("달성 불가 목표를 조용히 접는다 (정직 보고 제거)",
     "scansim/planner_mobile.py",
     '            f"작아 달성 불가 — {t_plan:g}mm 기준으로 계획 (속도·스캔율 조정 필요)")',
     '            f"기준으로 계획")  # [변이] 보고 문구 제거'),
]


def run_suite() -> tuple[bool, str]:
    p = subprocess.run(
        [sys.executable, "-m", "pytest", "scansim/tests/", "-q", "--no-header", "-x",
         "--ignore=scansim/tests/mutation_check.py"],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    lines = [l for l in (p.stdout or "").strip().splitlines() if l.strip()]
    return p.returncode == 0, (lines[-1] if lines else "(출력 없음)")


def main() -> int:
    originals = {f: (ROOT / f).read_text(encoding="utf-8")
                 for f in {m[1] for m in MUTATIONS}}
    try:
        ok, summary = run_suite()
        print(f"{'[대조군] 무변이':<44} {'PASS' if ok else 'FAIL':<9} {summary}", flush=True)
        if not ok:
            print("!! 무변이가 이미 FAIL — 실험 무의미. 스위트부터 고쳐라.")
            return 1

        killed = survived = unapplied = 0
        for name, fpath, old, new in MUTATIONS:
            src = originals[fpath]
            if src.count(old) != 1:
                print(f"{name:<44} {'미적용':<9} 패턴 {src.count(old)}회 매치 — 실험 실패", flush=True)
                unapplied += 1
                continue
            (ROOT / fpath).write_text(src.replace(old, new), encoding="utf-8")
            ok, summary = run_suite()
            print(f"{name:<44} {'SURVIVED' if ok else 'KILLED':<9} {summary}", flush=True)
            killed += (not ok)
            survived += ok
            (ROOT / fpath).write_text(src, encoding="utf-8")

        ok, summary = run_suite()
        print(f"{'[복원 확인] 무변이':<44} {'PASS' if ok else 'FAIL':<9} {summary}", flush=True)
        print(f"\nKILLED {killed} · SURVIVED {survived} · 미적용 {unapplied}")
        return 0 if (survived == 0 and unapplied == 0 and ok) else 1
    finally:
        for f, src in originals.items():
            (ROOT / f).write_text(src, encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())

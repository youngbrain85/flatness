# -*- coding: utf-8 -*-
"""scansim CLI — 세부과업 2 덤프에서 스캔 계획·시뮬레이션 전 형식 산출물을 만든다.

사용 (계획 Task 8):
  python -m scansim.cli --dump bim/tests/fixtures/lh26_dump.json --mode both --out out/scan

산출물 (스펙 §1.1 — 형식 구속): CSV(커버리지 시계열) · JSON(계획·상태 스트림)
· PNG(계획/최종 지도·곡선·프레임) · GIF(애니메이션) · PDF(평가 보고서).
renderer 인자는 테스트 주입용 — 생략하면 워커 PlaywrightRenderer(Chromium)를 쓴다.
"""
from __future__ import annotations

import argparse

from scansim.config import ScanConfig
from scansim.report.build import DEFAULT_FURNITURE, build


def main(argv=None, renderer=None) -> int:
    ap = argparse.ArgumentParser(
        prog="python -m scansim.cli",
        description="스캔 커버리지 계획·시뮬레이션 + 평가 PDF")
    ap.add_argument("--dump", required=True,
                    help="세부과업 2 DB 덤프 JSON (spaces[].outline, mm 정수)")
    ap.add_argument("--out", required=True, help="산출물 디렉터리")
    ap.add_argument("--mode", choices=["mobile", "tls", "both"], default="both",
                    help="스캔 모드 (기본 both)")
    ap.add_argument("--furniture", default=str(DEFAULT_FURNITURE),
                    help="가구 스냅샷 JSON (기본: 도면 8쪽 추출 스냅샷)")
    ap.add_argument("--config", default=None,
                    help="ScanConfig JSON — 생략 시 기본값(가정값). 모르는 키는 오류")
    args = ap.parse_args(argv)

    cfg = ScanConfig.from_json(args.config) if args.config else ScanConfig()
    modes = ("mobile", "tls") if args.mode == "both" else (args.mode,)
    pdf = build(args.dump, args.out, cfg=cfg, furniture_path=args.furniture,
                renderer=renderer, modes=modes)
    print("작성:", pdf)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

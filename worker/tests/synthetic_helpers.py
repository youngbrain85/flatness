# 엔진 픽스처를 파일 경로로 로드(패키지명 'tests' 충돌 회피) — worker/tests와
# engine/tests가 동일한 최상위 패키지명 'tests'를 쓰므로 일반 import로는
# 어느 쪽이 로드될지 보장할 수 없다. importlib로 파일 경로를 직접 지정해
# 별도 모듈 이름(engine_synthetic)으로 로드한다.
import importlib.util
from pathlib import Path

_p = Path(__file__).resolve().parents[2] / "engine" / "tests" / "fixtures" / "synthetic.py"
_spec = importlib.util.spec_from_file_location("engine_synthetic", _p)
synthetic = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(synthetic)

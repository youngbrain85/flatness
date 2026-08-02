# 워커 컨테이너 (Railway 배포용) - 빌드 컨텍스트는 저장소 루트다(engine/·worker/ 둘 다 필요).
FROM python:3.11-slim

# fonts-noto-cjk: 백로그 티켓 37 - 이 패키지가 없으면 보고서 PDF와 matplotlib 히스토그램의
# 한글이 네모 상자로 렌더된다. 템플릿 폴백 체인의 첫 후보('Noto Sans KR')가 여기서 걸린다.
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-noto-cjk fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY engine/ ./engine/
COPY worker/ ./worker/

RUN pip install --no-cache-dir -e ./engine && pip install --no-cache-dir -e ./worker

# Chromium 본체 + 실행에 필요한 시스템 라이브러리. pip로 설치된 playwright 버전과
# 정확히 짝이 맞는 빌드를 내려받으므로 버전 불일치 실패가 없다.
RUN playwright install --with-deps chromium

WORKDIR /app/worker
ENV PYTHONUNBUFFERED=1 STORAGE_BACKEND=supabase
CMD ["python", "-m", "flatworker"]

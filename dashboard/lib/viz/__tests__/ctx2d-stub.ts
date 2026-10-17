// 2D 캔버스 호출 기록 스텁(테스트 헬퍼. vitest include 가 `**/__tests__/**/*.test.{ts,tsx}` 라
// 이 파일 자체는 테스트로 수집되지 않는다). jsdom 에는 2D 컨텍스트가 없다.
// 칠하기·글자·선 호출마다 그 순간의 fillStyle·strokeStyle·lineWidth·font 를 남겨
// "무엇을 · 어떤 색으로 · 어디에" 그렸는지를 실제 렌더 경로에서 관찰한다. 픽셀은 화면 대조가 맡는다.
export interface PaintOp {
  op: 'fillRect' | 'strokeRect' | 'fillText' | 'stroke' | 'fill';
  style: string;
  lineWidth: number;
  font: string;
  args: (number | string)[];
}

export function recording2d() {
  const ops: PaintOp[] = [];
  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    setTransform() {},
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    fillRect(x: number, y: number, w: number, h: number) {
      ops.push({ op: 'fillRect', style: String(ctx.fillStyle), lineWidth: ctx.lineWidth, font: ctx.font, args: [x, y, w, h] });
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      ops.push({ op: 'strokeRect', style: String(ctx.strokeStyle), lineWidth: ctx.lineWidth, font: ctx.font, args: [x, y, w, h] });
    },
    fillText(text: string, x: number, y: number) {
      ops.push({ op: 'fillText', style: String(ctx.fillStyle), lineWidth: ctx.lineWidth, font: ctx.font, args: [text, x, y] });
    },
    stroke() {
      ops.push({ op: 'stroke', style: String(ctx.strokeStyle), lineWidth: ctx.lineWidth, font: ctx.font, args: [] });
    },
    fill() {
      ops.push({ op: 'fill', style: String(ctx.fillStyle), lineWidth: ctx.lineWidth, font: ctx.font, args: [] });
    },
    measureText(text: string) {
      return { width: text.length * 6 };
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

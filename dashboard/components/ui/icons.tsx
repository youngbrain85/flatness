// 16px 스트로크 아이콘 세트. 이모지·딩뱃 금지 규칙의 구현체 - 화면의 모든 아이콘은 이 컴포넌트를
// 거친다. data-icon으로 테스트가 식별한다. 선 굵기 1.8 은 다크 C안 아트보드의 인라인 SVG 와 같다.
import type { ReactNode, SVGProps } from 'react';

// 최종 리뷰 Important 4(T1): Record<string, …>이면 IconName에 이름을 더해도 PATHS 누락이
// 컴파일에 안 걸려 아이콘이 조용히 빈 svg로 나간다. IconName으로 키를 좁혀 전수 강제한다.
const PATHS: Record<IconName, ReactNode> = {
  'check-circle': <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.5 2.5L16 9.5" /></>,
  // 아트보드 경고 상자(Stage·Upload)의 삼각형 그대로
  'alert-triangle': <><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17v.5" /></>,
  // 아트보드 오류 상자(RegistrationNew·ReportDetail)의 원 + 느낌표
  'alert-circle': <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.5" /></>,
  'x-circle': <><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></>,
  'info-circle': <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  'minus-circle': <><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></>,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  logout: <path d="M10 17l5-5-5-5M15 12H3M20 4v16" />,
  trend: <><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></>,
  download: <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" /></>,
  photo: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-8 8" /></>,
  // ReportDetail 아트보드의 'PDF 다시 생성' 아이콘(T8 추가). 재분석 등 "다시 실행" 액션 공용.
  refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v5h-5" /></>,
  // 스캔 업로드(아트보드 Upload): 고른 파일 줄의 문서 아이콘과 '선택한 파일 빼기'의 X(T6 추가).
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" /><path d="M14 3v5h5" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  // 스캔 작업대(아트보드 ScanDone) '이 위치의 보고서 생성'의 문서 아이콘(T7 추가).
  report: <><path d="M14 3H6v18h12V7l-4-4z" /><path d="M14 3v4h4M9 13h6M9 17h6" /></>,
};

export type IconName =
  | 'check-circle' | 'alert-triangle' | 'alert-circle' | 'x-circle' | 'info-circle' | 'clock' | 'minus-circle'
  | 'chevron-right' | 'chevron-down' | 'chevron-left' | 'search' | 'plus' | 'upload' | 'user'
  | 'menu' | 'logout' | 'trend' | 'download' | 'external' | 'photo' | 'refresh'
  | 'file' | 'x' | 'report';

export function Icon({ name, size = 16, className, ...rest }:
  { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-icon={name}
      className={`shrink-0${className ? ` ${className}` : ''}`} {...rest}>
      {PATHS[name]}
    </svg>
  );
}

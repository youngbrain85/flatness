// PhotoUploader + 업로드 후 서버 데이터 새로고침
'use client';
import { useRouter } from 'next/navigation';
import { PhotoUploader } from './photo-uploader';
import type { PhotoRef } from '@/lib/photos/upload';

export function RefreshOnUpload({ target }: { target: PhotoRef }) {
  const router = useRouter();
  return <PhotoUploader target={target} onUploaded={() => router.refresh()} />;
}

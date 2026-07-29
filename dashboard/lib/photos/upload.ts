import type { SupabaseClient } from '@supabase/supabase-js';
import type { PhotoRow } from '@/lib/domain/types';
import { photoFilePath, photoStorageKey } from './paths';

export type PhotoRef = { site_id: string } | { location_id: string } | { scan_id: string };

export async function uploadPhoto(
  supabase: SupabaseClient,
  file: File,
  target: PhotoRef,
  caption?: string,
): Promise<PhotoRow> {
  const id = crypto.randomUUID();
  const filePath = photoFilePath(id, file.name);
  if (!filePath) throw new Error('지원하지 않는 이미지 형식입니다 (jpg/jpeg/png/webp)');
  const { error: upErr } = await supabase.storage.from('photos').upload(photoStorageKey(filePath), file);
  if (upErr) throw upErr;
  const { data, error } = await supabase
    .from('photos')
    .insert({ id, file_path: filePath, caption: caption ?? null, ...target })
    .select()
    .single();
  if (error) throw error;
  return data as PhotoRow;
}

export async function photoUrl(supabase: SupabaseClient, filePath: string): Promise<string | null> {
  const { data } = await supabase.storage.from('photos').createSignedUrl(photoStorageKey(filePath), 3600);
  return data?.signedUrl ?? null;
}

import { supabase } from '@/lib/supabaseClient';

export const uploadFile = async (
  userId: string,
  file: File
): Promise<{ url: string | null; error: Error | null }> => {
  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}/${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExt}`;

    const { data, error } = await supabase.storage
      .from('datasets')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      throw error;
    }

    const { data: publicUrlData } = supabase.storage
      .from('datasets')
      .getPublicUrl(fileName);

    return { url: publicUrlData.publicUrl, error: null };
  } catch (error: any) {
    console.error('Storage upload error:', error.message);
    return { url: null, error };
  }
};

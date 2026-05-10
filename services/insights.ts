import { supabase } from "@/lib/supabaseClient";
import { Insight } from "@/types";

export async function getUserInsights(userId: string): Promise<{ data: Insight[] | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from("insights")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      return { data: null, error: error.message };
    }

    return { data, error: null };
  } catch (error: any) {
    console.error("Error fetching user insights:", error.message);
    return { data: null, error: error.message };
  }
}

import { getSupabase } from "@/lib/supabaseClient";

/* =========================
   TYPES (light safety layer)
========================= */

export interface DatasetInput {
  userId: string;
  name: string;
  country?: string;
  type?: string;
  fileUrl?: string;
}

export interface InsightInput {
  userId: string;
  datasetId: string;
  summary: string;
  riskLevel: "Low" | "Medium" | "High";
  trend: string;
}

/* =========================
   DATASETS
========================= */

export async function saveDataset(data: DatasetInput) {
  const { data: result, error } = await getSupabase()
    .from("datasets")
    .insert([
      {
        user_id: data.userId,
        name: data.name,
        country: data.country,
        type: data.type,
        file_url: data.fileUrl,
      },
    ])
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: result };
}

export async function getUserDatasets(userId: string) {
  const { data, error } = await getSupabase()
    .from("datasets")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/* =========================
   INSIGHTS
========================= */

export async function saveInsight(data: InsightInput) {
  const { data: result, error } = await getSupabase()
    .from("insights")
    .insert([
      {
        user_id: data.userId,
        dataset_id: data.datasetId,
        summary: data.summary,
        risk_level: data.riskLevel,
        trend: data.trend,
      },
    ])
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: result };
}

export async function getDatasetInsights(datasetId: string, userId: string) {
  const { data, error } = await getSupabase()
    .from("insights")
    .select("*")
    .eq("dataset_id", datasetId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

export async function getUserInsights(userId: string) {
  const { data, error } = await getSupabase()
    .from("insights")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/* =========================
   OPTIONAL UTILITY
========================= */

/**
 * Counts rows only, so no dataset contents are returned to the caller. These
 * application-level checks narrow access but do not replace database RLS
 * policies, which remain the enforcement boundary.
 */
export async function verifyDatasetOwnership(
  datasetId: string,
  userId: string,
): Promise<{ owned: boolean; error?: string }> {
  const { count, error } = await getSupabase()
    .from("datasets")
    .select("id", { count: "exact", head: true })
    .eq("id", datasetId)
    .eq("user_id", userId);

  if (error) {
    return { owned: false, error: error.message };
  }

  return { owned: (count ?? 0) === 1 };
}

export async function deleteDataset(datasetId: string, userId: string) {
  const { error } = await getSupabase()
    .from("datasets")
    .delete()
    .eq("id", datasetId)
    .eq("user_id", userId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

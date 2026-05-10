import { supabase } from "@/lib/supabaseClient";

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
  const { data: result, error } = await supabase
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
  const { data, error } = await supabase
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
  const { data: result, error } = await supabase
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

export async function getDatasetInsights(datasetId: string) {
  const { data, error } = await supabase
    .from("insights")
    .select("*")
    .eq("dataset_id", datasetId)
    .order("created_at", { ascending: false });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/* =========================
   OPTIONAL UTILITY
========================= */

export async function deleteDataset(datasetId: string) {
  const { error } = await supabase
    .from("datasets")
    .delete()
    .eq("id", datasetId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

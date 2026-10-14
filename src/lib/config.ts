import path from "node:path";

export const ROOT = process.cwd();
export const RAW_DIR = path.join(ROOT, "data", "raw");
export const DERIVED_DIR = path.join(ROOT, "data", "derived");
export const SYNTHETIC_DIR = path.join(ROOT, "data", "synthetic");
export const REVIEWS_DIR = path.join(DERIVED_DIR, "reviews");

export function datasetToday(): string {
  return process.env.DATASET_TODAY || "2026-09-28";
}

export const REVIEWER_NAME = "Karandeep";

/** Days between two ISO dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

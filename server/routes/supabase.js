import express from "express";
import { getSupabaseClient } from "../lib/supabase.js";

export const router = express.Router();

router.get("/health", async (_req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("products").select("id", { head: true, count: "exact" });
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

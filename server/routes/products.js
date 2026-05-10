import express from "express";
import { pool } from "../lib/db.js";

export const router = express.Router();

router.get("/resolve", async (req, res) => {
  const section = String(req.query.section || "").trim();
  const brand = String(req.query.brand || "").trim();
  const slug = String(req.query.slug || "").trim();

  if (!section || !brand || !slug) {
    return res.status(400).json({ error: "invalid_params" });
  }

  const { rows } = await pool.query(
    `
      select id, slug, name, brand, section, price_cents, currency, image_url, active
      from products
      where section = $1 and brand = $2 and slug = $3 and active = true
      limit 1
    `,
    [section, brand, slug]
  );

  if (rows.length === 0) return res.status(404).json({ error: "product_not_found" });
  return res.json(rows[0]);
});

router.get("/", async (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 24)));
  const offset = Math.max(0, Number(req.query.offset || 0));

  const { rows } = await pool.query(
    `
      select id, slug, name, brand, section, price_cents, currency, image_url, active
      from products
      where active = true
      order by created_at desc
      limit $1 offset $2
    `,
    [limit, offset]
  );

  res.json({ items: rows, limit, offset });
});

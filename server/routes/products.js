import express from "express";
import { pool } from "../lib/db.js";

export const router = express.Router();

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


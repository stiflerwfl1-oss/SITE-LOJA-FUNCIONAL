import express from "express";
import { requireEnv } from "../lib/env.js";
import { pool } from "../lib/db.js";
import { fromCents } from "../lib/money.js";

export const router = express.Router();

async function mpFetch(path, opts = {}) {
  const token = requireEnv("MP_ACCESS_TOKEN");
  const url = `https://api.mercadopago.com${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`mercadopago_error:${res.status}`);
    err.details = json;
    throw err;
  }
  return json;
}

router.post("/mercadopago", async (req, res) => {
  const { orderId } = req.body || {};
  if (!orderId || typeof orderId !== "string") return res.status(400).json({ error: "invalid_orderId" });

  const orderRes = await pool.query(
    `select id, status, currency, total_cents, mp_preference_id from orders where id = $1`,
    [orderId]
  );
  if (orderRes.rowCount === 0) return res.status(404).json({ error: "order_not_found" });
  const order = orderRes.rows[0];
  if (order.status !== "pending") return res.status(409).json({ error: "order_not_pending" });

  // Idempotency: if a preference already exists for this order, return it.
  if (order.mp_preference_id) {
    const pref = await mpFetch(`/checkout/preferences/${encodeURIComponent(order.mp_preference_id)}`);
    return res.json({
      orderId,
      preferenceId: pref.id,
      initPoint: pref.init_point,
      sandboxInitPoint: pref.sandbox_init_point
    });
  }

  const itemsRes = await pool.query(
    `
      select oi.qty, oi.unit_price_cents, p.name
      from order_items oi
      join products p on p.id = oi.product_id
      where oi.order_id = $1
      order by oi.created_at asc
    `,
    [orderId]
  );

  const baseUrl = process.env.BASE_URL || "";
  const notificationUrl = baseUrl ? `${baseUrl}/api/webhooks/mercadopago` : undefined;
  const successUrl = baseUrl ? `${baseUrl}/checkout/sucesso/?order=${encodeURIComponent(orderId)}` : undefined;
  const failureUrl = baseUrl ? `${baseUrl}/checkout/erro/?order=${encodeURIComponent(orderId)}` : undefined;
  const pendingUrl = baseUrl ? `${baseUrl}/checkout/pendente/?order=${encodeURIComponent(orderId)}` : undefined;

  const preference = await mpFetch("/checkout/preferences", {
    method: "POST",
    body: JSON.stringify({
      external_reference: orderId,
      notification_url: notificationUrl,
      items: itemsRes.rows.map((it) => ({
        title: it.name,
        quantity: Number(it.qty),
        currency_id: order.currency || "BRL",
        unit_price: fromCents(it.unit_price_cents)
      })),
      back_urls: {
        success: successUrl,
        failure: failureUrl,
        pending: pendingUrl
      },
      auto_return: "approved"
    })
  });

  await pool.query(`update orders set mp_preference_id = $2, updated_at = now() where id = $1`, [
    orderId,
    preference.id
  ]);

  res.json({
    orderId,
    preferenceId: preference.id,
    initPoint: preference.init_point,
    sandboxInitPoint: preference.sandbox_init_point
  });
});

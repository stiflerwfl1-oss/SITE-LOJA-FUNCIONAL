import express from "express";
import { router as products } from "./products.js";
import { router as cart } from "./cart.js";
import { router as orders } from "./orders.js";
import { router as payments } from "./payments.js";
import { router as webhooks } from "./webhooks.js";
import { router as supabase } from "./supabase.js";

export const router = express.Router();

router.use("/products", products);
router.use("/cart", cart);
router.use("/orders", orders);
router.use("/payments", payments);
router.use("/webhooks", webhooks);
router.use("/supabase", supabase);

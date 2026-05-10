import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../lib/db.js";
import { newId } from "../lib/ids.js";
import { toCents } from "../lib/money.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");
const pricesPath = path.join(root, "precos.json");
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractAttributes(tag) {
  const attrs = {};
  const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = attrRegex.exec(tag))) {
    attrs[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function findMetaContent(html, propertyName) {
  const metaRegex = /<meta\b[^>]*>/gi;
  let match;
  while ((match = metaRegex.exec(html))) {
    const attrs = extractAttributes(match[0]);
    const key = attrs.property || attrs.name;
    if (String(key || "").toLowerCase() === propertyName.toLowerCase()) {
      return cleanText(attrs.content || "");
    }
  }
  return "";
}

function extractFirst(content, patterns) {
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]) return decodeHtml(cleanText(match[1]));
  }
  return "";
}

function normalizeImageUrl(value, sourceDir = root) {
  const image = decodeHtml(cleanText(value));
  if (!image) return null;
  if (/^(?:https?:)?\/\//i.test(image)) return image;

  const normalized = image.replace(/\\/g, "/");
  const absolutePath = path.resolve(sourceDir, normalized);
  const relative = path.relative(root, absolutePath).replace(/\\/g, "/");
  if (relative.startsWith("../")) return normalized.replace(/^\.\//, "");
  return `/${relative}`;
}

function extractImageFromArea(html, className) {
  const areaMatch = html.match(new RegExp(`<[^>]+class=["'][^"']*${className}[^"']*["'][^>]*>[\\s\\S]*?<\\/div>`, "i"));
  if (!areaMatch) return "";
  return extractFirst(areaMatch[0], [
    /<img[^>]+(?:data-src|src)=["']([^"']+)["'][^>]*>/i
  ]);
}

function extractProduct(html, fallbackName, sourceDir) {
  const name = findMetaContent(html, "og:title") || extractFirst(html, [
    /<h1[^>]+class=["'][^"']*product-name[^"']*["'][^>]*>(.*?)<\/h1>/is,
    /<h1[^>]*>(.*?)<\/h1>/is,
    /<div[^>]+class=["'][^"']*product-name[^"']*["'][^>]*>(.*?)<\/div>/is,
    /<title[^>]*>(.*?)<\/title>/is
  ]);

  const image =
    findMetaContent(html, "og:image") ||
    extractImageFromArea(html, "image-show") ||
    extractImageFromArea(html, "box-gallery");

  return {
    name: name || fallbackName,
    imageUrl: normalizeImageUrl(image, sourceDir)
  };
}

function titleFromSlug(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function* iterPrices(prices) {
  for (const [section, brands] of Object.entries(prices || {})) {
    if (!brands || typeof brands !== "object") continue;
    for (const [brand, slugs] of Object.entries(brands)) {
      if (!slugs || typeof slugs !== "object") continue;
      for (const [slug, price] of Object.entries(slugs)) {
        yield { section, brand, slug, price };
      }
    }
  }
}

function buildProduct(item) {
  const htmlPath = path.join(root, item.section, item.brand, item.slug, "index.html");
  const hasHtml = fs.existsSync(htmlPath);
  const fallbackName = titleFromSlug(item.slug);
  const sourceDir = hasHtml ? path.dirname(htmlPath) : root;
  const extracted = hasHtml ? extractProduct(fs.readFileSync(htmlPath, "utf8"), fallbackName, sourceDir) : {
    name: fallbackName,
    imageUrl: null
  };

  const priceCents = toCents(item.price);
  if (priceCents < 0 || !Number.isFinite(priceCents)) {
    return { status: "skipped", reason: "invalid_price", hasHtml };
  }

  const sourcePath = hasHtml ? path.relative(root, htmlPath).replace(/\\/g, "/") : null;
  return {
    status: "ok",
    hasHtml,
    product: {
      id: newId("prod"),
      slug: item.slug,
      name: extracted.name,
      brand: item.brand,
      section: item.section,
      priceCents,
      imageUrl: extracted.imageUrl,
      active: priceCents > 0,
      sourcePath
    }
  };
}

async function importProduct(item) {
  const built = buildProduct(item);
  if (built.status !== "ok") return built;
  const product = built.product;
  await pool.query(
    `
      insert into products (id, slug, name, brand, section, price_cents, currency, image_url, active, source_path)
      values ($1, $2, $3, $4, $5, $6, 'BRL', $7, $8, $9)
      on conflict (section, brand, slug)
      do update set
        name = excluded.name,
        price_cents = excluded.price_cents,
        image_url = coalesce(excluded.image_url, products.image_url),
        source_path = coalesce(excluded.source_path, products.source_path),
        active = excluded.active,
        updated_at = now()
    `,
    [
      product.id,
      product.slug,
      product.name,
      product.brand,
      product.section,
      product.priceCents,
      product.imageUrl,
      product.active,
      product.sourcePath
    ]
  );

  return built;
}

function recordStats(stats, result) {
  if (result.status !== "ok") {
    stats.skipped += 1;
    return;
  }
  stats.imported += 1;
  if (!result.hasHtml) stats.missingHtml += 1;
  if (result.product.priceCents === 0) stats.zeroPrice += 1;
  if (!result.product.imageUrl) stats.missingImage += 1;
  if (stats.samples.length < 10) {
    stats.samples.push({
      section: result.product.section,
      brand: result.product.brand,
      slug: result.product.slug,
      name: result.product.name,
      imageUrl: result.product.imageUrl,
      priceCents: result.product.priceCents,
      active: result.product.active,
      sourcePath: result.product.sourcePath
    });
  }
}

async function run() {
  if (!dryRun && !process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for db:import-products");
  if (!fs.existsSync(pricesPath)) throw new Error(`Missing ${pricesPath}`);

  const prices = readJson(pricesPath);
  const stats = {
    imported: 0,
    skipped: 0,
    missingHtml: 0,
    zeroPrice: 0,
    missingImage: 0,
    dryRun,
    samples: []
  };

  for (const item of iterPrices(prices)) {
    if (dryRun) {
      recordStats(stats, buildProduct(item));
    } else {
      recordStats(stats, await importProduct(item));
    }
  }

  if (!dryRun) await pool.end();
  console.log(JSON.stringify(stats, null, 2));
}

run().catch(async (error) => {
  try {
    await pool.end();
  } catch {}
  console.error(error);
  process.exit(1);
});

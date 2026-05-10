alter table products
  add column if not exists source_path text;

delete from products p
using products duplicate
where p.section is not distinct from duplicate.section
  and p.brand is not distinct from duplicate.brand
  and p.slug is not distinct from duplicate.slug
  and p.id <> duplicate.id
  and (
    p.updated_at < duplicate.updated_at
    or (p.updated_at = duplicate.updated_at and p.id < duplicate.id)
  );

create unique index if not exists products_catalog_key
  on products(section, brand, slug);

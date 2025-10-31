CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  brand JSONB,
  category JSONB,
  description TEXT,
  dimensions JSONB,
  attributes JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE user_products (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  owner VARCHAR(100) NOT NULL,
  owner_id UUID NOT NULL,
  price DECIMAL(10,2) NOT NULL CHECK (price > 0),
  number_in_stock INTEGER NOT NULL DEFAULT 1,
  discount DECIMAL(10,2) DEFAULT 0,
  phone_number VARCHAR(20),
  status VARCHAR(20) DEFAULT 'available',
  address TEXT,
  city VARCHAR(50),
  colors TEXT[],
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE product_images (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  image_path TEXT NOT NULL,
  thumbnail_path TEXT,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Create indexes for better performance
CREATE INDEX idx_products_owner ON products(owner_id);
CREATE INDEX idx_product_images ON product_images(product_id);



ALTER TABLE wishlist_items(
ADD COLUMN stock_index INTEGER REFERENCES user_products(id) ON DELETE CASCADE,
  ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT unique_wishlist_product_stock_id UNIQUE (wishlist_id, product_id, stock_index);
  )




ALTER TABLE cart_items
ADD CONSTRAINT unique_cart_user_product_stock_id UNIQUE (cart_id, user_product_id, stock_index);















-- Main product table (language-independent)
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  brand JSONB,
  category JSONB,
  dimensions JSONB,
  attributes JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Product translations (multilingual)
CREATE TABLE product_translations (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  language_code VARCHAR(5) NOT NULL CHECK (language_code IN ('en', 'fr')),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  UNIQUE (product_id, language_code)
);

-- User-specific product listing
CREATE TABLE user_products (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  owner VARCHAR(100) NOT NULL,
  owner_id UUID NOT NULL,
  price DECIMAL(10,2) NOT NULL CHECK (price > 0),
  number_in_stock INTEGER NOT NULL DEFAULT 1,
  discount DECIMAL(10,2) DEFAULT 0,
  phone_number VARCHAR(20),
  status VARCHAR(20) DEFAULT 'available',
  address TEXT,
  city VARCHAR(50),
  colors TEXT[],
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Set the sequence to the highest existing ID + 1
SELECT setval('product_translations_id_seq', (SELECT MAX(id) FROM product_translations) + 1);
-- Add helper columns for unique constraint
ALTER TABLE products ADD COLUMN name_en TEXT, ADD COLUMN name_fr TEXT;

-- Populate helper columns (run once)
UPDATE products p
SET name_en = pt_en.name, name_fr = pt_fr.name
FROM product_translations pt_en, product_translations pt_fr
WHERE pt_en.product_id = p.id AND pt_en.language_code = 'en'
  AND pt_fr.product_id = p.id AND pt_fr.language_code = 'fr';

-- Add unique constraint
CREATE UNIQUE INDEX unique_product_combo
ON products (
  LOWER(TRIM(brand->>'name')),
  LOWER(TRIM(category->>'main')),
  LOWER(TRIM(category->>'sub')),
  LOWER(TRIM(name_en)),
  LOWER(TRIM(name_fr))
);


ALTER TABLE products
  ADD COLUMN brand_name TEXT,
  ADD COLUMN category_main TEXT,
  ADD COLUMN category_sub TEXT,
  ADD COLUMN name_en TEXT,
  ADD COLUMN name_fr TEXT;



-- show all duplicates
SELECT
  LOWER(TRIM(brand->>'name')) AS brand_name,
  LOWER(TRIM(category->>'main')) AS category_main,
  LOWER(TRIM(category->>'sub')) AS category_sub,
  LOWER(TRIM(name_en)) AS name_en,
  LOWER(TRIM(name_fr)) AS name_fr,
  COUNT(*)
FROM products
GROUP BY 1,2,3,4,5
HAVING COUNT(*) > 1;;


--aotomatic trigger for product name refresh
CREATE OR REPLACE FUNCTION sync_product_names()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.language_code = 'en') THEN
    UPDATE products SET name_en = NEW.name WHERE id = NEW.product_id;
  ELSIF (NEW.language_code = 'fr') THEN
    UPDATE products SET name_fr = NEW.name WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS product_translations_sync ON product_translations;

CREATE TRIGGER product_translations_sync
AFTER INSERT OR UPDATE ON product_translations
FOR EACH ROW EXECUTE FUNCTION sync_product_names();


---manual trigger for product name refresh
UPDATE products p
SET name_en = pt_en.name, name_fr = pt_fr.name
FROM product_translations pt_en, product_translations pt_fr
WHERE pt_en.product_id = p.id AND pt_en.language_code = 'en'
  AND pt_fr.product_id = p.id AND pt_fr.language_code = 'fr';

  CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_products_updated_at ON products;
CREATE TRIGGER set_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
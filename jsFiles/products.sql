-- 1) users must come first
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL       PRIMARY KEY,
  email      VARCHAR(100) NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,
  user_name  VARCHAR(100),
  full_name  VARCHAR(255),
  created_at TIMESTAMP    DEFAULT NOW()
);

-- 2) products (now users(id) exists)
CREATE TABLE IF NOT EXISTS products (
  id          SERIAL       PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  price       DECIMAL(10,2) CHECK (price > 0),
  description TEXT,
  category    VARCHAR(50),
  brand       VARCHAR(50),
  owner_id    INTEGER      REFERENCES users(id),
  likes       INTEGER      DEFAULT 0,
  created_at  TIMESTAMP    DEFAULT NOW()
);

-- 3) product_likes (references products)
CREATE TABLE IF NOT EXISTS product_likes (
  id          SERIAL       PRIMARY KEY,
  product_id  INTEGER      REFERENCES products(id) ON DELETE CASCADE,
  user_id     INTEGER      NOT NULL,
  username    VARCHAR(100) NOT NULL,
  liked_at    TIMESTAMP    DEFAULT NOW(),
  UNIQUE (product_id, user_id)
);

-- 4) full‑text search index (complete the to_tsvector call)
CREATE INDEX IF NOT EXISTS idx_products_search
  ON products
  USING GIN(to_tsvector('english', name || ' ' || category || ' ' || brand));

-- 5) likes lookup index
CREATE INDEX IF NOT EXISTS idx_product_likes
  ON product_likes(product_id, user_id);

-- 6) product_images (references products)
CREATE TABLE IF NOT EXISTS product_images (
  id          SERIAL       PRIMARY KEY,
  product_id  INTEGER      REFERENCES products(id) ON DELETE CASCADE,
  image_path TEXT NOT NULL,
  uploaded_at TIMESTAMP    DEFAULT NOW()
);

-- CREATE TABLE products (
--   id SERIAL PRIMARY KEY,
--   name TEXT,
--   price NUMERIC,
--   category TEXT,
--   created_at TIMESTAMP DEFAULT NOW()
-- );
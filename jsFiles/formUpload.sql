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



ALTER TABLE products
ADD COLUMN posted_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP




















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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Set the sequence to the highest existing ID + 1
SELECT setval('product_translations_id_seq', (SELECT MAX(id) FROM product_translations) + 1);
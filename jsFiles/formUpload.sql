-- Products table
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  brand JSONB,
  category VARCHAR(50),
  price DECIMAL(10,2) NOT NULL CHECK (price > 0),
  quantity INTEGER NOT NULL DEFAULT 1,
  number_in_stock INTEGER NOT NULL,
  discount DECIMAL(5,2) DEFAULT 0,
  owner VARCHAR(100) NOT NULL,
  phone_number VARCHAR(20),
  description TEXT,
  status VARCHAR(20) DEFAULT 'available',
  address TEXT,
  likes INTEGER DEFAULT 0,
  city VARCHAR(50),
  color VARCHAR(30),
  weight DECIMAL(10,2) NOT NULL,
  owner_id INTEGER NOT NULL,
  location JSONB,
  size VARCHAR(20),
   wallet INTEGER DEFAULT 0,
  posted_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ALTER TABLE products

-- ADD COLUMN lacation JSONB;

-- Product images table
CREATE TABLE product_images (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  image_path TEXT NOT NULL,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_products_owner ON products(owner_id);
CREATE INDEX idx_product_images ON product_images(product_id);
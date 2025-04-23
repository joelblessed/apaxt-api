const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'your_database',
  password: process.env.DB_PASS || 'your_password',
  port: process.env.DB_PORT || 5432,



  -- Products table
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  price DECIMAL(10,2) CHECK (price > 0),
  description TEXT,
  category VARCHAR(50),
  brand VARCHAR(50),
  owner_id INTEGER REFERENCES users(id),
  likes INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Product likes tracking
CREATE TABLE product_likes (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  username VARCHAR(100) NOT NULL,
  liked_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (product_id, user_id)
);

-- Create indexes for performance
CREATE INDEX idx_products_search ON products USING GIN(to_tsvector('english', name || ' ' || category || ' ' || brand));
CREATE INDEX idx_product_likes ON product_likes(product_id, user_id);
});



module.exports = {
  query: (text, params) => pool.query(text, params),
};
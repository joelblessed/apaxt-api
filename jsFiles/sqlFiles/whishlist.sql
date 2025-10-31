-- Users table (assuming it exists)
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  -- other fields...
);

-- Wishlist table (one per user)
CREATE TABLE wishlists (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id),
  UNIQUE(session_id)

);

-- Wishlist items table
CREATE TABLE wishlist_items (
  id SERIAL PRIMARY KEY,
  wishlist_id INTEGER REFERENCES wishlists(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
stock_index INTEGER REFERENCES user_products(id) ON DELETE CASCADE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
UNIQUE (wishlist_id, product_id, stock_index)
);
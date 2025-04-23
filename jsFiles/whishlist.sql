-- Users table (assuming it exists)
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  -- other fields...
);

-- Wishlist table (one per user)
CREATE TABLE wishlists (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE
);

-- Wishlist items table
CREATE TABLE wishlist_items (
  id SERIAL PRIMARY KEY,
  wishlist_id INT REFERENCES wishlists(id) ON DELETE CASCADE,
  product_id UUID NOT NULL
);
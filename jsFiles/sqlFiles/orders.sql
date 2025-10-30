CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  cart JSONB NOT NULL,
  shipping JSONB NOT NULL,
  status TEXT DEFAULT 'Pending',
  total_amount NUMERIC(10, 2) NOT NULL,
  payment_status TEXT DEFAULT 'Pending',
  payment_method TEXT,
  delivered BOOLEAN DEFAULT FALSE,
  placed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
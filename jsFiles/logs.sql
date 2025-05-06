-- Activity logs table
CREATE TABLE IF NOT EXISTS activity_logs (
    id SERIAL PRIMARY KEY,
    user_id UUID,
    action VARCHAR(100) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Viewed products table
CREATE TABLE IF NOT EXISTS viewed_products (
    id SERIAL PRIMARY KEY,
    user_id UUID,
    product_id INTEGER NOT NULL,
    log_id INTEGER NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (log_id) REFERENCES activity_logs(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

  -- Add to your schema
CREATE TYPE activity_type AS ENUM (
    'login', 
    'logout', 
    'product_view', 
    'purchase',
    'account_update'
  );
  
  -- Update your activity_logs table
ALTER TABLE activity_logs ADD COLUMN activity_type activity_type;
  -- Automatically delete logs older than 1 year
  CREATE OR REPLACE FUNCTION clean_old_logs()
  RETURNS TRIGGER AS $$
  BEGIN
    DELETE FROM activity_logs WHERE timestamp < NOW() - INTERVAL '1000 year';
    RETURN NULL;
  END;
  $$ LANGUAGE plpgsql;
  
  CREATE TRIGGER trigger_clean_old_logs
  AFTER INSERT ON activity_logs
  EXECUTE FUNCTION clean_old_logs();

-- Indexes for better performance
CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_viewed_products_user_id ON viewed_products(user_id);
CREATE INDEX idx_viewed_products_log_id ON viewed_products(log_id);
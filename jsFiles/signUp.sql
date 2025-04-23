-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    username VARCHAR(50) UNIQUE,
    full_name VARCHAR(100),
    phone_number VARCHAR(20),
    city VARCHAR(50),
    country VARCHAR(50),
    wallet DECIMAL(12, 2) DEFAULT 0,
    address TEXT,
    gender VARCHAR(10),
    role VARCHAR(20) DEFAULT 'user',
    date_of_birth DATE,
    referral_code VARCHAR(20) UNIQUE,
    referred_by VARCHAR(20),
    discount DECIMAL(5, 2) DEFAULT 0,
    has_made_first_purchase BOOLEAN DEFAULT FALSE,
    sign_up_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    location JSONB,
    CONSTRAINT valid_discount CHECK (discount >= 0 AND discount <= 100)
);




-- Indexes for better performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_referral_code ON users(referral_code);
CREATE INDEX idx_users_referred_by ON users(referred_by);


-- ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;
-- ALTER TABLE users ADD COLUMN verification_token VARCHAR(100);
-- CREATE TABLE user_audit_log (
--   id SERIAL PRIMARY KEY,
--   user_id INTEGER REFERENCES users(id),
--   action VARCHAR(50) NOT NULL,
--   details JSONB,
--   ip_address VARCHAR(45),
--   user_agent TEXT,
--   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );

-- CREATE TABLE referral_events (
--   id SERIAL PRIMARY KEY,
--   referrer_id INTEGER NOT NULL REFERENCES users(id),
--   referred_id INTEGER NOT NULL REFERENCES users(id),
--   reward_amount DECIMAL(10, 2) NOT NULL,
--   event_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );
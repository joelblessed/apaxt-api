-- Password reset tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS password_reset_attempts (
    id SERIAL PRIMARY KEY,
    email VARCHAR(100),
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    successful BOOLEAN DEFAULT FALSE
);

CREATE OR REPLACE FUNCTION clean_expired_tokens()
RETURNS VOID AS $$
BEGIN
    DELETE FROM password_reset_tokens WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Index for faster lookups
CREATE INDEX idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens(user_id);
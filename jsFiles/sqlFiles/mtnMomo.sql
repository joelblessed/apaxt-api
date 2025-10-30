-- MoMo API users table
CREATE TABLE IF NOT EXISTS momo_api_users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL UNIQUE,  -- X-Reference-Id
    api_key VARCHAR(255),
    callback_host VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- MoMo transactions table
CREATE TABLE IF NOT EXISTS momo_transactions (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(36) NOT NULL UNIQUE,  -- X-Reference-Id for the transaction
    external_id VARCHAR(36) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'EUR',
    payer_msisdn VARCHAR(15) NOT NULL,
    status VARCHAR(50),
    status_reason VARCHAR(255),
    momo_token_id VARCHAR(255),
    payment_ref_id VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- MoMo tokens table
CREATE TABLE IF NOT EXISTS momo_tokens (
    id SERIAL PRIMARY KEY,
    token VARCHAR(255) NOT NULL,
    user_id VARCHAR(36) NOT NULL REFERENCES momo_api_users(user_id),
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX idx_momo_transactions_transaction_id ON momo_transactions(transaction_id);
CREATE INDEX idx_momo_transactions_external_id ON momo_transactions(external_id);
CREATE INDEX idx_momo_tokens_user_id ON momo_tokens(user_id);
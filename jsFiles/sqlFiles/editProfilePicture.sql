-- CREATE TABLE users (
--   id SERIAL PRIMARY KEY,
--   email TEXT,
--   full_name TEXT,
--   profile_image TEXT DEFAULT '/profileImages/default-avatar.png',
--   -- add other fields you need
--   ...
-- );

-- Users table (if not already exists)


CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(100),
    phone_number VARCHAR(20),
    address TEXT,
    gender VARCHAR(10),
    profile_image TEXT DEFAULT '/profileImages/default-avatar.png',
    country VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Profile image history table (optional for tracking changes)
CREATE TABLE IF NOT EXISTS profile_image_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image_path TEXT NOT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
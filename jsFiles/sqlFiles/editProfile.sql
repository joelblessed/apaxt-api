CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT,
  userName TEXT,
  fullName TEXT,
  phoneNumber TEXT,
  address TEXT,
  country TEXT,
  city TEXT,
  profile_image TEXT, -- for storing path like "/profileImages/filename.jpg"
  -- Add any other fields you already have
  ...
);
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { query } = require("./db"); // PostgreSQL connection
const router = express.Router();
require("dotenv").config();

const SECRET_KEY = process.env.JWT_SECRET;

// Middleware to verify JWT token
const verifyToken = async (req, res, next) => {
  const token = req.header("Authorization");
  if (!token) return res.status(401).json({ message: "Access denied. No token provided." });

  try {
    const decoded = jwt.verify(token.replace("Bearer ", ""), SECRET_KEY);
    
    // Verify user still exists in database
    const { rows } = await query('SELECT id FROM users WHERE id = $1', [decoded.userId]);
    if (rows.length === 0) {
      return res.status(401).json({ message: "User no longer exists" });
    }
    
    req.user = decoded;
    next();
  } catch (err) {
    res.status(400).json({ message: "Invalid token" });
  }
};



const rateLimit = require('express-rate-limit');
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
router.use(apiLimiter);

const validatePassword = (password) => {
  return password.length >= 8 && 
         /[A-Z]/.test(password) && 
         /[0-9]/.test(password) &&
         /[!@#$%^&*]/.test(password);
};


// Helper function to generate referral code
const generateReferralCode = () => crypto.randomBytes(4).toString("hex").toUpperCase();

// Sign Up (Register User)
router.post("/signup", async (req, res) => {
  const {
    email,
    password,
    userName,
    fullName,
    phoneNumber,
    city,
    country,
    wallet = 0,
    address,
    gender,
    role = 'user',
    dateOfBirth,
    referralCode,
    discount = 0,
    location
  } = req.body;

  try {
    // Check if user exists
    const userExists = await query('SELECT 1 FROM users WHERE email = $1 OR username = $2', [email, userName]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Validate referral code if provided
    if (referralCode) {
      const referrerExists = await query('SELECT 1 FROM users WHERE referral_code = $1', [referralCode]);
      if (referrerExists.rows.length === 0) {
        return res.status(400).json({ message: "Invalid referral code" });
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const newReferralCode = generateReferralCode();

    // Insert new user
    const { rows } = await query(
      `INSERT INTO users (
        email, password_hash, username, full_name, phone_number, city, country,
        wallet, address, gender, role, date_of_birth, referral_code, referred_by,
        discount, location
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id, email, username, referral_code`,
      [
        email, hashedPassword, userName, fullName, phoneNumber, city, country,
        wallet, address, gender, role, dateOfBirth, newReferralCode, referralCode,
        discount, location
      ]
    );

    res.status(201).json({ 
      message: "User registered successfully", 
      referralCode: rows[0].referral_code 
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ error: "Error registering user" });
  }
});

// Apply 5% referral reward (ONLY for first purchase)
router.post("/apply-reward", verifyToken, async (req, res) => {
  const { userId, amountPaid } = req.body;

  try {
    // Begin transaction
    await query('BEGIN');

    // Get referred user with row lock
    const referredUser = await query(
      `SELECT id, referred_by, has_made_first_purchase 
       FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );

    if (referredUser.rows.length === 0) {
      await query('ROLLBACK');
      return res.status(404).json({ message: "User not found" });
    }

    const userData = referredUser.rows[0];

    // Check if it's the first purchase
    if (userData.has_made_first_purchase) {
      await query('ROLLBACK');
      return res.json({ message: "Referral reward only applies to the first purchase." });
    }

    if (userData.referred_by) {
      // Get referrer with row lock
      const referrer = await query(
        `SELECT id, username, wallet 
         FROM users WHERE referral_code = $1 FOR UPDATE`,
        [userData.referred_by]
      );

      if (referrer.rows.length > 0) {
        const reward = (5 / 100) * amountPaid;
        const referrerData = referrer.rows[0];

        // Update referrer's wallet
        await query(
          'UPDATE users SET wallet = wallet + $1 WHERE id = $2',
          [reward, referrerData.id]
        );

        // Mark user's first purchase
        await query(
          'UPDATE users SET has_made_first_purchase = TRUE WHERE id = $1',
          [userId]
        );

        // Commit transaction
        await query('COMMIT');

        return res.json({ 
          message: `Reward applied! ${referrerData.username} earned $${reward.toFixed(2)}`,
          reward: reward.toFixed(2)
        });
      }
    }

    // No referrer found, rollback
    await query('ROLLBACK');
    res.json({ message: "No referrer found for this user." });

  } catch (error) {
    await query('ROLLBACK');
    console.error("Apply reward error:", error);
    res.status(500).json({ error: "Error processing referral reward" });
  }
});

module.exports = router;


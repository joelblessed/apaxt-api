const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { query } = require("./db"); // Your PostgreSQL connection
const router = express.Router();
require("dotenv").config();

const JWT_SECRET = process.env.JWT_SECRET;
const saltRounds = 10;

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Access token is required" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
};

// Get all users (admin only)
router.get("/AllProfiles", authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { rows } = await query('SELECT id, username, email, full_name, role FROM users');
    res.json(rows);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Error fetching users" });
  }
});

// User signin
router.post("/signin", async (req, res) => {
  const { identifier, password, sessionId } = req.body;

  try {
    // Find user by email or username
    const { rows } = await query(
      `SELECT * FROM users 
       WHERE email = $1 OR username = $1`,
      [identifier]
    );

    if (rows.length === 0) {
      console.warn(`Signin attempt failed: Invalid identifier - ${identifier}`);
      return res.status(400).json({ message: "Invalid identifier. Please check your email or username." });
    }

    const user = rows[0];

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password" });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, role: user.role, username: user.username },
      JWT_SECRET,
      { expiresIn: "24h" }
    );
    const cartSync = await syncUserSessionTable({
      table: "carts",
      user_id: user.id,
      session_id: sessionId,
    });

    const wishlistSync = await syncUserSessionTable({
      table: "wishlists",
      user_id: user.id,
      session_id: sessionId,
    });
    // Return user data (excluding sensitive information)
    const userData = {
      token,
      user: {
        role: user.role,
        user_id: user.id
      }

    };

    res.json(userData);
  } catch (error) {
    console.error("Signin error:", error);
    res.status(500).json({ error: "Error signing in" });
  }
});

// Get user profile
router.get("/profile", authenticateToken, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, username, email, first_name, last_name, date_of_birth, phone_number, 
       address, gender, profile_image,city, country, wallet, referral_code, role
       FROM users WHERE id = $1`,
      [req.user.userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = rows[0];
    res.json({
      user
    });
  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({ error: "Error fetching profile" });
  }
});


// Get user profile
router.get("/profile/:id", authenticateToken, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, username, email, first_name, last_name, phone_number, 
       address, gender, profile_image, country, wallet, referral_code, role
       FROM users WHERE id = $1`,
      [req.user.userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({ error: "Error fetching profile" });
  }
});

module.exports = router;





 async function syncUserSessionTable({ table, user_id, session_id }) {
  if (!user_id || !session_id) {
    return { success: false, message: "Missing user_id or session_id" };
  }

  try {
    // 1️⃣ Check for existing user record
    const checkUser = await query(
      `SELECT id FROM ${table} WHERE user_id = $1`,
      [user_id]
    );

    // 2️⃣ Check for existing session record
    const checkSession = await query(
      `SELECT id FROM ${table} WHERE session_id = $1`,
      [session_id]
    );

    // 3️⃣ CASE 1: User already has record → update session_id
    if (checkUser.rows.length > 0) {
      const updateSession = await query(
        `UPDATE ${table}
         SET session_id = $1
         WHERE user_id = $2
         RETURNING id`,
        [session_id, user_id]
      );

      if (updateSession.rows.length > 0) {
        return { success: true, message: `✅ Updated session_id in ${table}` };
      }
    }

    // 4️⃣ CASE 2: Session record exists but user doesn’t → attach user_id
    if (checkSession.rows.length > 0) {
      const updateUser = await query(
        `UPDATE ${table}
         SET user_id = $1
         WHERE session_id = $2
         RETURNING id`,
        [user_id, session_id]
      );

      if (updateUser.rows.length > 0) {
        return { success: true, message: `✅ Linked session ${table} to user` };
      }
    }

    // 5️⃣ CASE 3: Neither exist → create a new record
    const insertRecord = await query(
      `INSERT INTO ${table} (user_id, session_id)
       VALUES ($1, $2)
       RETURNING id`,
      [user_id, session_id]
    );

    if (insertRecord.rows.length > 0) {
      return { success: true, message: `🆕 Created new ${table}` };
    }

    return { success: false, message: "⚠️ No action performed" };
  } catch (err) {
    console.error(`${table} sync error:`, err);
    return { success: false, message: `❌ Failed to sync ${table}` };
  }
}
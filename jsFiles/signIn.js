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
  const { identifier, password } = req.body;

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
      { userId: user.id, role: user.role }, 
      JWT_SECRET, 
      { expiresIn: "1h" }
    );

    // Return user data (excluding sensitive information)
    const userData = {
      token,
      role: user.role,
      userName: user.username,
      email: user.email,
      wallet: user.wallet,
      referralCode: user.referral_code,
      fullName: user.full_name,
      phoneNumber: user.phone_number,
      address: user.address,
      gender: user.gender,
      profileImage: user.profile_image,
      country: user.country,
      id: user.id // Ensure ID is included in the response
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
      `SELECT id, username, email, full_name, phone_number, 
       address, gender, profile_image, country, wallet, referral_code, role
       FROM users WHERE id = $1`,
      [req.user.userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = rows[0];
    res.json({
      id: user.id,
      userName: user.username,
      email: user.email,
      fullName: user.full_name,
      phoneNumber: user.phone_number,
      address: user.address,
      gender: user.gender,
      profileImage: user.profile_image,
      country: user.country,
      wallet: user.wallet,
      referralCode: user.referral_code,
      role: user.role
    });
  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({ error: "Error fetching profile" });
  }
});

// // Update user profile
// router.put("/updateProfile/:id", authenticateToken, async (req, res) => {
//   try {
//     // Verify user can only update their own profile unless admin
//     if (req.user.userId !== parseInt(req.params.id) && req.user.role !== 'admin') {
//       return res.status(403).json({ message: "Unauthorized" });
//     }

//     const { 
//       fullName, phoneNumber, address, 
//       gender, profileImage, country 
//     } = req.body;

//     const { rows } = await query(
//       `UPDATE users SET 
//         full_name = COALESCE($1, full_name),
//         phone_number = COALESCE($2, phone_number),
//         address = COALESCE($3, address),
//         gender = COALESCE($4, gender),
//         profile_image = COALESCE($5, profile_image),
//         country = COALESCE($6, country),
//         updated_at = CURRENT_TIMESTAMP
//        WHERE id = $7
//        RETURNING *`,
//       [
//         fullName, phoneNumber, address, 
//         gender, profileImage, country,
//         req.params.id
//       ]
//     );

//     if (rows.length === 0) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     const updatedUser = rows[0];
//     res.json({
//       id: updatedUser.id,
//       userName: updatedUser.username,
//       email: updatedUser.email,
//       fullName: updatedUser.full_name,
//       phoneNumber: updatedUser.phone_number,
//       address: updatedUser.address,
//       gender: updatedUser.gender,
//       profileImage: updatedUser.profile_image,
//       country: updatedUser.country,
//       wallet: updatedUser.wallet,
//       referralCode: updatedUser.referral_code,
//       role: updatedUser.role
//     });
//   } catch (error) {
//     console.error("Update error:", error);
//     res.status(500).json({ error: "Error updating profile" });
//   }
// });

// Get user profile
router.get("/profile/:id", authenticateToken, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, username, email, full_name, phone_number, 
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
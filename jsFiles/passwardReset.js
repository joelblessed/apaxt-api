const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const { query } = require("./db"); // Your PostgreSQL connection
const router = express.Router();
require("dotenv").config();

const SECRET_KEY = process.env.JWT_SECRET;




const rateLimit = require("express-rate-limit");
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5 // limit each IP to 5 requests per windowMs
});


const validatePassword = (password) => {
    return password.length >= 8 && 
           /[A-Z]/.test(password) && 
           /[0-9]/.test(password);
};
// Email transporter configuration
const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || "gmail",
    auth: {
        user: process.env.EMAIL_FROM,
        pass: process.env.EMAIL_PASS
    }
});



// 1. Forgot Password: Generate Reset Link
router.post("/forgot-password", limiter, async (req, res) => {
    const { email } = req.body;

    try {
        // Check if user exists
        const userResult = await query(
            'SELECT id, email FROM users WHERE email = $1',
            [email]
        );

        if (userResult.rows.length === 0) {
            return res.status(400).json({ message: "User not found" });
        }

        const user = userResult.rows[0];

        // Generate Reset Token (Valid for 15 minutes)
        const token = jwt.sign({ userId: user.id }, SECRET_KEY, { expiresIn: "15m" });
        const resetLink = `${process.env.FRONTEND_URL}/reset-password/${token}`;

        // Store token in database
        await query(
            'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'15 minutes\')',
            [user.id, token]
        );

        // Send Email
        await transporter.sendMail({
            from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
            to: email,
            subject: "Password Reset Request",
            html: `
                <p>You requested a password reset. Click the link below to reset your password:</p>
                <a href="${resetLink}">Reset Password</a>
                <p>This link will expire in 15 minutes.</p>
            `
        });

        res.json({ message: "Password reset link sent to email." });
    } catch (error) {
        console.error("Forgot password error:", error);
        res.status(500).json({ message: "Error processing password reset request" });
    }
});

// 2. Reset Password: Validate Token & Update Password
router.post("/reset-password", async (req, res) => {
    const { token, newPassword } = req.body;

    try {
        // Verify token
        const decoded = jwt.verify(token, SECRET_KEY);
        const userId = decoded.userId;

        // Check if token exists and is valid
        const tokenResult = await query(
            `SELECT id FROM password_reset_tokens 
             WHERE user_id = $1 AND token = $2 
             AND used = FALSE AND expires_at > NOW()`,
            [userId, token]
        );

        if (tokenResult.rows.length === 0) {
            return res.status(400).json({ message: "Invalid or expired token" });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Begin transaction
        await query('BEGIN');

        // Update user password
        await query(
            'UPDATE users SET password_hash = $1 WHERE id = $2',
            [hashedPassword, userId]
        );

        // Mark token as used
        await query(
            'UPDATE password_reset_tokens SET used = TRUE WHERE id = $1',
            [tokenResult.rows[0].id]
        );

        // Commit transaction
        await query('COMMIT');

        res.json({ message: "Password updated successfully" });
    } catch (error) {
        // Rollback on error
        await query('ROLLBACK');
        
        if (error.name === 'TokenExpiredError') {
            return res.status(400).json({ message: "Token has expired" });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(400).json({ message: "Invalid token" });
        }
        
        console.error("Reset password error:", error);
        res.status(500).json({ message: "Error resetting password" });
    }
});



module.exports = router;




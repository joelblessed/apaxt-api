const express = require("express");
const { query } = require("./db"); // Your PostgreSQL connection
const jwt = require("jsonwebtoken"); // Ensure you have this package installed
const router = express.Router();

// Middleware to authenticate token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: "Token not provided" });
  }

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) {
      console.error("Token verification failed:", err);
      return res.status(403).json({ error: "Invalid token" });
    }
    req.user = user;
    next();
  });
}

// Create a new activity log
router.post('/logs', authenticateToken, async (req, res) => {
  console.log("POST /logs called");
  const { action } = req.body;
  const userId = req.user.userId; // Get from authenticated token
  console.log("Request body:", req.body);
  console.log("Authenticated user ID:", userId);

  try {
    const { rows } = await query(
      'INSERT INTO activity_logs (user_id, action) VALUES ($1, $2) RETURNING *',
      [userId, action]
    );
    console.log("Activity log created:", rows[0]);

    res.status(201).json({
      id: rows[0].id,
      action: rows[0].action,
      timestamp: rows[0].timestamp
    });
  } catch (error) {
    console.error("Error creating log:", error);
    res.status(500).json({ error: "Error creating activity log" });
  }
});

// Record a viewed product
router.post('/viewedProducts', authenticateToken, async (req, res) => {
  console.log("POST /viewedProducts called");
  const { productId } = req.body;
  const userId = req.user.userId;
  console.log("Request body:", req.body);
  console.log("Authenticated user ID:", userId);

  try {
    // Get the user's most recent activity log
    const logResult = await query(
      'SELECT id FROM activity_logs WHERE user_id = $1 ORDER BY timestamp DESC LIMIT 1',
      [userId]
    );
    console.log("Most recent activity log:", logResult.rows);

    if (logResult.rows.length === 0) {
      console.warn("No activity log found for user ID:", userId);
      return res.status(404).json({ error: 'No activity log found for this user' });
    }

    const logId = logResult.rows[0].id;

    // Record the viewed product
    const { rows } = await query(
      `INSERT INTO viewed_products (user_id, product_id, log_id) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
      [userId, productId, logId]
    );
    console.log("Viewed product recorded:", rows[0]);

    res.status(201).json({
      id: rows[0].id,
      productId: rows[0].product_id,
      timestamp: rows[0].timestamp
    });
  } catch (error) {
    console.error("Error recording viewed product:", error);
    res.status(500).json({ error: "Error recording viewed product" });
  }
});

// Get all logs for a user
router.get('/logs/:userId', authenticateToken, async (req, res) => {
  console.log("GET /logs/:userId called");
  const { userId } = req.params;
  console.log("Requested user ID:", userId);

  // Verify the requesting user has permission
  if (req.user.userId !== parseInt(userId) && req.user.role !== 'admin') {
    console.warn("Unauthorized access attempt by user ID:", req.user.userId);
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const { rows } = await query(
      'SELECT * FROM activity_logs WHERE user_id = $1 ORDER BY timestamp DESC',
      [userId]
    );
    console.log("Fetched logs:", rows);

    const logs = rows.map(row => ({
      id: row.id,
      action: row.action,
      timestamp: row.timestamp
    }));

    res.status(200).json(logs);
  } catch (error) {
    console.error("Error fetching logs:", error);
    res.status(500).json({ error: "Error fetching activity logs" });
  }
});

// Get viewed products for a user
router.get('/viewedProducts/:userId', authenticateToken, async (req, res) => {
  console.log("GET /viewedProducts/:userId called");
  const { userId } = req.params;
  console.log("Requested user ID:", userId);

  // Verify the requesting user has permission
  if (req.user.userId !== parseInt(userId) && req.user.role !== 'admin') {
    console.warn("Unauthorized access attempt by user ID:", req.user.userId);
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const { rows } = await query(
      `SELECT vp.id, vp.product_id, vp.timestamp, p.name as product_name
       FROM viewed_products vp
       JOIN products p ON vp.product_id = p.id
       WHERE vp.user_id = $1
       ORDER BY vp.timestamp DESC`,
      [userId]
    );
    console.log("Fetched viewed products:", rows);

    const viewedProducts = rows.map(row => ({
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      timestamp: row.timestamp
    }));

    res.status(200).json(viewedProducts);
  } catch (error) {
    console.error("Error fetching viewed products:", error);
    res.status(500).json({ error: "Error fetching viewed products" });
  }
});

module.exports = router;

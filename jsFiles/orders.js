require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const {query} = require("./db"); // PostgreSQL connection
const router = express.Router();

router.use(cors());
router.use(express.json());


// Validate JWT token
const validateToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    console.error("Invalid token:", error);
    return null;
  }
};

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  const decoded = validateToken(token); // ✅ Correct
  if (!token || !decoded) {
    return res.status(401).json({ message: "Unauthorized: Invalid or missing token" });
  }
  req.user = decoded;
  next();
};
// 🟢 Place a new order
router.post("/order", async (req, res) => {
  const { orderData } = req.body;
  const token = req.headers.authorization?.split(" ")[1];
  const decoded = validateToken(token); // ✅ not authenticate

  if (!token || !decoded) {
    return res.status(401).json({ message: "Unauthorized: Invalid or missing token" });
  }
  
  try {
    const sql = `
      INSERT INTO orders (user_id, cart, shipping, status, total_amount, payment_method, user_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    const values = [
      orderData.userId,
      JSON.stringify(orderData.cart),
      JSON.stringify(orderData.shipping),
      orderData.status, // Ensure this matches the database type (e.g., VARCHAR or TEXT)
      orderData.totalAmount,
      orderData.paymentMethod,
      JSON.stringify(orderData.user_data),
    ];

    const result = await query(sql, values);
    res.status(201).json({ message: "Order placed successfully", order: result.rows[0] });

  } catch (err) {
    console.error("Error placing order:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// // 🟡 Get all orders (for testing/admin)
// router.get("/orders", async (req, res) => {
//   try {
//     const result = await query("SELECT * FROM orders ORDER BY placed_at DESC");
//     res.json({ orders: result.rows });
//   } catch (err) {
//     console.error("Error fetching orders:", err);
//     res.status(500).json({ message: "Internal server error" });
//   }
// });


// 1. Fetch all orders (admin/testing)
router.get("/orders", authenticate, async (req, res) => {
    try {
      const result = await query("SELECT * FROM orders ORDER BY placed_at DESC");
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Error fetching orders" });
    }
  });
  
  // 2. Fetch orders by userId
  router.get("/orders/:userId", authenticate, async (req, res) => {
    const { userId } = req.params;
    try {
      const result = await query(
        "SELECT * FROM orders WHERE user_id = $1 ORDER BY placed_at DESC",
        [userId]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Error fetching user orders" });
    }
  });
  
  // 3. Cancel an Order
  router.patch("/orders/cancel/:orderId", authenticate, async (req, res) => {
    const { orderId } = req.params;
    try {
      const result = await query(
        "UPDATE orders SET status = $1 WHERE id = $2 RETURNING *",
        ["Canceled", orderId]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ message: "Order not found" });
      }
      res.json({ message: "Order canceled successfully" });
    } catch (err) {
      res.status(500).json({ message: "Error canceling order" });
    }
  });
  
  // 4. Mark as Delivered and store delivery date
  router.patch("/orders/deliver/:orderId", authenticate, async (req, res) => {
    const { orderId } = req.params;
    const deliveryDate = new Date().toISOString();
  
    try {
      const getOrder = await query("SELECT shipping FROM orders WHERE id = $1", [orderId]);
      if (getOrder.rowCount === 0) return res.status(404).json({ message: "Order not found" });
  
      const shipping = getOrder.rows[0].shipping;
      shipping.deliveryDate = deliveryDate;
  
      await query(
        "UPDATE orders SET status = $1, shipping = $2 WHERE id = $3",
        ["Delivered", JSON.stringify(shipping), orderId]
      );
  
      res.json({ message: "Order marked as delivered", deliveryDate });
    } catch (err) {
      res.status(500).json({ message: "Error updating delivery status" });
    }
  });
  
module.exports = router;
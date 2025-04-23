const express = require("express");
const { Pool } = require("pg");
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});
router.post("/addToWishlist", async (req, res) => {
  const { productId, userId } = req.body;

  if (!productId) return res.status(400).json({ message: "Product ID is required" });

  try {
    let wishlist = await pool.query("SELECT * FROM wishlists WHERE user_id = $1", [userId]);
    
    if (wishlist.rowCount === 0) {
      await pool.query("INSERT INTO wishlists (user_id) VALUES ($1)", [userId]);
      wishlist = await pool.query("SELECT * FROM wishlists WHERE user_id = $1", [userId]);
    }

    const wishlistId = wishlist.rows[0].id;

    const exists = await pool.query(
      "SELECT * FROM wishlist_items WHERE wishlist_id = $1 AND product_id = $2",
      [wishlistId, productId]
    );

    if (exists.rowCount === 0) {
      await pool.query(
        "INSERT INTO wishlist_items (wishlist_id, product_id) VALUES ($1, $2)",
        [wishlistId, productId]
      );
    }

    res.json({ message: "Product added to wishlist successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});
router.post("/removeFromWishlist", async (req, res) => {
  const { productId, userId } = req.body;

  if (!productId) return res.status(400).json({ message: "Product ID is required" });

  try {
    const wishlist = await pool.query("SELECT * FROM wishlists WHERE user_id = $1", [userId]);
    if (wishlist.rowCount === 0) return res.json({ message: "Wishlist is empty" });

    await pool.query(
      "DELETE FROM wishlist_items WHERE wishlist_id = $1 AND product_id = $2",
      [wishlist.rows[0].id, productId]
    );

    res.json({ message: "Product removed from wishlist successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});
router.get("/wishlist/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const wishlist = await pool.query("SELECT * FROM wishlists WHERE user_id = $1", [userId]);

    if (wishlist.rowCount === 0) return res.json([]);

    const items = await pool.query(
      "SELECT product_id FROM wishlist_items WHERE wishlist_id = $1",
      [wishlist.rows[0].id]
    );

    res.json(items.rows.map((item) => item.product_id));
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});
router.post("/merge", async (req, res) => {
  const { userId, guestProductIds } = req.body; // guestProductIds = []

  if (!userId) return res.status(400).json({ message: "User ID is required" });

  try {
    let wishlist = await pool.query("SELECT * FROM wishlists WHERE user_id = $1", [userId]);

    if (wishlist.rowCount === 0) {
      await pool.query("INSERT INTO wishlists (user_id) VALUES ($1)", [userId]);
      wishlist = await pool.query("SELECT * FROM wishlists WHERE user_id = $1", [userId]);
    }

    const wishlistId = wishlist.rows[0].id;

    for (const productId of guestProductIds || []) {
      const exists = await pool.query(
        "SELECT * FROM wishlist_items WHERE wishlist_id = $1 AND product_id = $2",
        [wishlistId, productId]
      );

      if (exists.rowCount === 0) {
        await pool.query(
          "INSERT INTO wishlist_items (wishlist_id, product_id) VALUES ($1, $2)",
          [wishlistId, productId]
        );
      }
    }

    res.json({ message: "Wishlist merged successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});
const express = require("express");
const {query } = require("./db");
const router = express.Router();

// POST /wishlist/item
router.post('/wishlist/item', async (req, res) => {
  const { user_id, session_id, product_id } = req.body;

  if (!product_id || (!user_id && !session_id)) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    // Step 1: Check for existing wishlist
    let wishlistQuery = 'SELECT id FROM wishlists WHERE ';
    const params = [];
    if (user_id) {
      wishlistQuery += 'user_id = $1';
      params.push(user_id);
    } else {
      wishlistQuery += 'session_id = $1';
      params.push(session_id);
    }

    let wishlistResult = await query(wishlistQuery, params);

    let wishlistId;

    // Step 2: Insert if not found
    if (wishlistResult.rows.length > 0) {
      wishlistId = wishlistResult.rows[0].id;
    } else {
      const insertWishlist = await query(
        'INSERT INTO wishlists (user_id, session_id) VALUES ($1, $2) RETURNING id',
        [user_id || null, session_id || null]
      );
      wishlistId = insertWishlist.rows[0].id;
    }

    // Step 3: Insert item into wishlist_items (prevent duplicates)
    const insertItem = await query(
      `INSERT INTO wishlist_items (wishlist_id, product_id)
       VALUES ($1, $2)
       ON CONFLICT (wishlist_id, product_id)
       DO NOTHING
       RETURNING *`,
      [wishlistId, product_id]
    );

    if (insertItem.rows.length === 0) {
      return res.status(409).json({ message: 'Item already in wishlist' });
    }

    res.status(201).json({ item: insertItem.rows[0] });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to add to wishlist' });
  }
});


// POST /wishlist/migrate
router.post('/wishlist/migrate', async (req, res) => {
  const { session_id, user_id } = req.body;

  if (!session_id || !user_id) {
    return res.status(400).json({ message: 'Missing session_id or user_id' });
  }

  try {
    // Get guest wishlist
    const guestWishlistRes = await query(
      `SELECT id FROM wishlists WHERE session_id = $1`, [session_id]
    );
    if (guestWishlistRes.rowCount === 0) return res.json({ message: 'No guest wishlist found' });
    const guestWishlistId = guestWishlistRes.rows[0].id;

    // Get or create user wishlist
    const userWishlistRes = await query(
      `INSERT INTO wishlists (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING id`, [user_id]
    );

    let userWishlistId;
    if (userWishlistRes.rowCount > 0) {
      userWishlistId = userWishlistRes.rows[0].id;
    } else {
      // Fetch existing user wishlist if it already existed
      const fetchRes = await query(`SELECT id FROM wishlists WHERE user_id = $1`, [user_id]);
      userWishlistId = fetchRes.rows[0].id;
    }

    // Migrate wishlist items
    const migrateItemsQuery = `
      INSERT INTO wishlist_items (wishlist_id, product_id)
      SELECT $1, product_id
      FROM wishlist_items
      WHERE wishlist_id = $2
      ON CONFLICT DO NOTHING;
    `;
    await query(migrateItemsQuery, [userWishlistId, guestWishlistId]);

    // Delete guest wishlist and its items (CASCADE handles items)
    await query(`DELETE FROM wishlists WHERE id = $1`, [guestWishlistId]);

    res.status(200).json({ message: 'Wishlist migrated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Migration failed' });
  }
});


router.post("/removeFromWishlist", async (req, res) => {
  const { productId, userId } = req.body;

  if (!productId) return res.status(400).json({ message: "Product ID is required" });

  try {
    const wishlist = await query("SELECT * FROM wishlists WHERE user_id = $1", [userId]);
    if (wishlist.rowCount === 0) return res.json({ message: "Wishlist is empty" });

    await query(
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
    const wishlist = await query("SELECT * FROM wishlists WHERE user_id = $1", [userId]);

    if (wishlist.rowCount === 0) return res.json([]);

    const items = await query(
      "SELECT product_id FROM wishlist_items WHERE wishlist_id = $1",
      [wishlist.rows[0].id]
    );

    res.json(items.rows.map((item) => item.product_id));
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});



module.exports = router;
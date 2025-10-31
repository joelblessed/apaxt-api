const express = require("express");
const { query } = require("./db");
const router = express.Router();
const fallbackImage = "https://f004.backblazeb2.com/file/apaxt-images/products/logo.png";
// POST /wishlist/item
router.post('/wishlist/item', async (req, res) => {
  const { userId, sessionId, productId, stockIndex } = req.body;

  if (!productId || (!userId && !sessionId)) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    // Step 1: Check for existing wishlist

    let wishlistResult;
 

    
    if (userId || sessionId) {
      wishlistResult = await query(
        'SELECT id FROM wishlists WHERE user_id = $1 OR session_id = $2',
        [userId, sessionId]
      );

    }
    
    let wishlistId;

    // Step 2: Insert if not found
    if (wishlistResult.rows.length > 0) {
      wishlistId = wishlistResult.rows[0].id;

    } else {
      const insertWishlist = await query(
        'INSERT INTO wishlists (user_id, session_id) VALUES ($1, $2) RETURNING id',
        [userId || null, sessionId || null]
      );
      wishlistId = insertWishlist.rows[0].id;
    }

    // Step 3: Insert item into wishlist_items (prevent duplicates)
    const insertItem = await query(
      `INSERT INTO wishlist_items (wishlist_id, product_id, stock_index)
       VALUES ($1, $2 ,$3)
       ON CONFLICT (wishlist_id, product_id, stock_index)
       DO NOTHING
       RETURNING *`,
      [wishlistId, productId, stockIndex]
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
// router.post('/wishlist/migrate', async (req, res) => {
//   const { session_id, user_id } = req.body;

//   if (!session_id || !user_id) {
//     return res.status(400).json({ message: 'Missing session_id or user_id' });
//   }

//   try {
//     // Get guest wishlist
//     const guestWishlistRes = await query(
//       `SELECT id FROM wishlists WHERE session_id = $1`, [session_id]
//     );
//     if (guestWishlistRes.rowCount === 0) return res.json({ message: 'No guest wishlist found' });
//     const guestWishlistId = guestWishlistRes.rows[0].id;

//     // Get or create user wishlist
//     const userWishlistRes = await query(
//       `INSERT INTO wishlists (user_id) VALUES ($1)
//        ON CONFLICT (user_id) DO NOTHING
//        RETURNING id`, [user_id]
//     );

//     let userWishlistId;
//     if (userWishlistRes.rowCount > 0) {
//       userWishlistId = userWishlistRes.rows[0].id;
//     } else {
//       // Fetch existing user wishlist if it already existed
//       const fetchRes = await query(`SELECT id FROM wishlists WHERE user_id = $1`, [user_id]);
//       userWishlistId = fetchRes.rows[0].id;
//     }

//     // Migrate wishlist items
//     const migrateItemsQuery = `
//       INSERT INTO wishlist_items (wishlist_id, product_id)
//       SELECT $1, product_id
//       FROM wishlist_items
//       WHERE wishlist_id = $2
//       ON CONFLICT DO NOTHING;
//     `;
//     await query(migrateItemsQuery, [userWishlistId, guestWishlistId]);

//     // Delete guest wishlist and its items (CASCADE handles items)
//     await query(`DELETE FROM wishlists WHERE id = $1`, [guestWishlistId]);

//     res.status(200).json({ message: 'Wishlist migrated successfully' });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Migration failed' });
//   }
// });


router.post("/removeFromWishlist", async (req, res) => {
  const { productId, userId, sessionId, stockIndex } = req.body;

  if (!productId) return res.status(400).json({ message: "Product ID is required" });

  try {
    const wishlist = await query("SELECT * FROM wishlists WHERE user_id = $1 OR session_id =$2", [userId, sessionId]);
    if (wishlist.rowCount === 0) return res.json({ message: "Wishlist is empty" });

    await query(
      "DELETE FROM wishlist_items WHERE wishlist_id = $1 AND product_id = $2 AND stock_index =$3",
      [wishlist.rows[0].id, productId, stockIndex]
    );

    res.json({ message: "Product removed from wishlist successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});



router.get("/wishlist/:userId", async (req, res) => {
  const { userId} = req.params;
  const { lang = "en" } = req.query; // optional language code for translation

  try {
    // 1️⃣ Get wishlist ID for this user    
    const wishlist = await query("SELECT id FROM wishlists WHERE user_id = $1 OR session_id = $2", [userId, userId]);
    if (wishlist.rowCount === 0) return res.json([]);

    // 2️⃣ Get all product IDs from the wishlist
    const items = await query(
      "SELECT product_id FROM wishlist_items WHERE wishlist_id = $1",
      [wishlist.rows[0].id]
    );

    if (items.rowCount === 0) return res.json([]);

    const productIds = items.rows.map((i) => i.product_id);

    // 3️⃣ Fetch product details using your full structure
    const productsResult = await query(
      `
      SELECT 
        p.id,
        p.brand,
        p.category,
        p.dimensions,
        p.attributes,
        p.created_at,
        p.thumbnail_index,
        pt.name,
        pt.description,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'id', up.id,
            'price', up.price,
            'discount', up.discount,
            'status', up.status,
            'colors', up.colors,
            'owner', up.owner,
            'owner_id', up.owner_id,
            'number_in_stock', up.number_in_stock,
            'phone_number', up.phone_number,
            'address', up.address,
            'city', up.city
          ))
          FROM user_products up 
          WHERE up.product_id = p.id
        ) AS user_products,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'image_path', pi.image_path,
            'thumbnail_path', pi.thumbnail_path
          ))
          FROM product_images pi
          WHERE pi.product_id = p.id
        ) AS imagespath
      FROM products p
      JOIN product_translations pt 
        ON p.id = pt.product_id AND pt.language_code = $1
      WHERE p.id = ANY($2)
      ORDER BY p.created_at DESC
      `,
      [lang, productIds]
    );


 const products = productsResult.rows.map((product) => {
      const imageData = product.imagespath || [];

      const images = imageData.map(img => img.image_path).filter(Boolean);
      const thumbnails = imageData.map(img => img.thumbnail_path).filter(Boolean);

      return {
        ...product,
        images: images.length ? images : [fallbackImage],
        thumbnails: thumbnails.length ? thumbnails : [fallbackImage],
        primaryImage: images[0] || fallbackImage,
        thumbnail: thumbnails[0] || fallbackImage,
      };
    });

    res.json({
      success: true,
      products,
      totalResults: products.length
    });
  } catch (err) {
    console.error("Error fetching wishlist:", err);
    res.status(500).json({ message: "Server error" });
  }
});


router.get("/wishlistArray/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const wishlist = await query("SELECT * FROM wishlists WHERE user_id = $1 OR session_id =$2", [userId, userId]);

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
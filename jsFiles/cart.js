const express = require("express");
const jwt = require("jsonwebtoken");
const router = express.Router();
const { query } = require("./db"); // Your PostgreSQL connection
require("dotenv").config();

const JWT_SECRET = process.env.JWT_SECRET;
const fallbackImage = "https://f004.backblazeb2.com/file/apaxt-images/products/logo.png";
// Middleware: Verify Token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
  }
};

// Helper function to get or create user cart
const getOrCreateCart = async (userId) => {
  // Check if cart exists
  const cartResult = await query(
    'SELECT id FROM carts WHERE user_id = $1 OR session_id =$1',
    [userId]
  );

  if (cartResult.rows.length === 0) {
    // Create new cart if doesn't exist
    const newCart = await query(
      'INSERT INTO carts (user_id) VALUES ($1) RETURNING id',
      [userId]
    );
    return newCart.rows[0].id;
  }
  return cartResult.rows[0].id;
};


router.get("/cartArray/:userId", async (req, res) => {
  const { userId, } = req.params;


  try {
    const cartId = await getOrCreateCart(userId);

    const cartItems = await query(
      `SELECT *
             FROM cart_items 
          
             WHERE cart_id = $1`,
      [cartId]
    );

    res.json({ cart: cartItems.rows });
  } catch (error) {
    console.error("Error fetching cart:", error);
    res.status(500).json({ message: "Failed to fetch cart" });
  }
});

// 1. Get User Cart
router.get("/cart/:userId", async (req, res) => {
  const { userId } = req.params;
  const { lang = "en" } = req.query;

  try {
    // 1️⃣ Get the user's cart
    const cart = await query("SELECT id FROM carts WHERE user_id = $1 OR sessionId = $2", [userId]);
    if (cart.rowCount === 0) return res.json([]);

    // 2️⃣ Get all user_product_ids from cart_items
    const items = await query(
      "SELECT user_product_id, quantity FROM cart_items WHERE cart_id = $1",
      [cart.rows[0].id]
    );

    if (items.rowCount === 0) return res.json([]);

    const userProductIds = items.rows.map((i) => i.user_product_id);

    // 3️⃣ Fetch product data (joining user_products to products)
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
        jsonb_agg(DISTINCT jsonb_build_object(
          'id', up.id,
          'product_id', up.product_id,
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
        )) AS user_products,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'image_path', pi.image_path,
            'thumbnail_path', pi.thumbnail_path
          ))
          FROM product_images pi
          WHERE pi.product_id = p.id
        ) AS imagespath
      FROM user_products up
      JOIN products p ON up.product_id = p.id
      JOIN product_translations pt 
        ON p.id = pt.product_id AND pt.language_code = $1
      WHERE up.id = ANY($2)
      GROUP BY p.id, pt.name, pt.description
      ORDER BY p.created_at DESC
      `,
      [lang, userProductIds]
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
    console.error("Error fetching cart:", err);
    res.status(500).json({ message: "Server error" });
  }
});



// 2. Add to Cart
router.post("/cart", async (req, res) => {
  try {
    const { user_id, session_id, user_product_id, quantity, price_at_added, discount_at_added, stock_index, metadata } = req.body;
    const { lang = "en" } = req.query;

    if (!user_product_id) {
      return res.status(400).json({ message: "Product ID is required" });
    }
    // 1️⃣ Find existing cart for this user or session
    let cartResult;

    if (user_id && session_id) {
      cartResult = await query(
        'SELECT id FROM carts WHERE user_id = $1 OR session_id = $2',
        [user_id, session_id]
      );
    } else if (user_id) {
      cartResult = await query(
        'SELECT id FROM carts WHERE user_id = $1',
        [user_id]
      );
    } else {
      cartResult = await query(
        'SELECT id FROM carts WHERE session_id = $1',
        [session_id]
      );
    }

    let cartId;

    // 2️⃣ If no cart exists, create a new one
    if (cartResult.rows.length > 0) {
      cartId = cartResult.rows[0].id;
    } else {
      const insertCart = await query(
        'INSERT INTO carts (user_id, session_id) VALUES ($1, $2) RETURNING id',
        [user_id || null, session_id || null]
      );
      cartId = insertCart.rows[0].id;
    }

    // 3️⃣ Check if the product already exists in the cart
    const existingItem = await query(
      'SELECT id, quantity FROM cart_items WHERE cart_id = $1 AND user_product_id = $2 AND stock_index = $3',
      [cartId, user_product_id, stock_index]
    );

    if (existingItem.rows.length > 0) {
      // 4️⃣ Update quantity if it exists
      await query(
        'UPDATE cart_items SET quantity = quantity + $1 WHERE id = $2',
        [quantity, existingItem.rows[0].id]
      );
    } else {
      // 5️⃣ Insert new item into cart
      await query(
        'INSERT INTO cart_items (cart_id, user_product_id, quantity, price_at_added, discount_at_added, stock_index, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [cartId, user_product_id, quantity, price_at_added, discount_at_added, stock_index, metadata]
      );
    }

    // 6️⃣ Return updated cart items
    const updatedCart = await query(
      `SELECT ci.id, ci.quantity, p.id as product_id, pt.name
       FROM cart_items ci
       JOIN products p ON ci.user_product_id = p.id
            JOIN product_translations pt 
        ON p.id = pt.product_id AND pt.language_code = $2
       WHERE ci.cart_id = $1`,
      [cartId, lang]
    );

    res.json({ message: "Product added to cart", cart: updatedCart.rows });
  } catch (error) {
    console.error("Error adding to cart:", error);
    res.status(500).json({ message: "Failed to add to cart" });
  }
});


// 3. Update Product Quantity in Cart
router.put('/cart/:action', async (req, res) => {
  const { userId, sessionId = "oiuytredfghjfhgh", productId, stock_index } = req.body;

  try {
    const { action } = req.params;
    const result = await query(
      'SELECT id FROM carts WHERE user_id = $1 OR session_id = $2',
      [userId, sessionId]
    );

    const cartId = result.rows[0]?.id;

    console.log("cartId", cartId)

    const itemResult = await query(
      'SELECT id, quantity FROM cart_items WHERE cart_id = $1 AND user_product_id = $2 AND stock_index = $3',
      [cartId, productId, stock_index]
    );

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ message: "Product not found in cart" });
    }

    if (action === 'increment') {
      await query(
        'UPDATE cart_items SET quantity = quantity + 1 WHERE id = $1',
        [itemResult.rows[0].id]
      );
    } else if (action === 'decrement') {
      if (itemResult.rows[0].quantity > 1) {
        await query(
          'UPDATE cart_items SET quantity = quantity - 1 WHERE id = $1',
          [itemResult.rows[0].id]
        );
      } else {
        await query(
          'DELETE FROM cart_items WHERE id = $1',
          [itemResult.rows[0].id]
        );
      }
    } else {
      return res.status(400).json({ message: "Invalid action" });
    }

    const updatedCart = await query(
      `SELECT ci.id, p.id as user_product_id, ci.quantity 
             FROM cart_items ci
             JOIN products p ON ci.user_product_id = p.id
             WHERE ci.cart_id = $1`,
      [cartId]
    );

    res.json({ cart: updatedCart.rows });
  } catch (error) {
    console.error("Error updating cart:", error);
    res.status(500).json({ message: "Failed to update cart" });
  }
});

// 4. Remove from Cart
router.delete("/removeFromCart", async (req, res) => {
  try {
    const { productId, userId, sessionId, stock_index } = req.body;
   const fetchcartId = await query(
  'SELECT id FROM carts WHERE user_id = $1 OR session_id = $2',
  [userId, sessionId]
);

const cartId = fetchcartId.rows[0]?.id;

    const result = await query(
      'DELETE FROM cart_items WHERE cart_id = $1 AND user_product_id = $2 AND stock_index =$3 RETURNING id',
      [cartId, productId, stock_index]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Product not found in cart" });
    }

    // Get updated cart
    const updatedCart = await query(
      `SELECT ci.id, p.id as user_product_id, ci.quantity 
             FROM cart_items ci
             JOIN products p ON ci.user_product_id = p.id
             WHERE ci.cart_id = $1`,
      [cartId]
    );

    res.json({
      message: "Product removed from cart",
      cart: updatedCart.rows
    });
  } catch (error) {
    console.error("Error removing from cart:", error);
    res.status(500).json({ message: "Failed to remove from cart" });
  }
});



// router.post("/cart/merge", verifyToken, async (req, res) => {
//     try {
//         const { localCart } = req.body;

//         if (!Array.isArray(localCart)) {
//             return res.status(400).json({ message: "Invalid cart data" });
//         }

//         const cartId = await getOrCreateCart(req.userId);
//         await query('BEGIN');

//         // Fetch current cart items
//         const existingCartRes = await query(
//             'SELECT product_id, quantity FROM cart_items WHERE cart_id = $1',
//             [cartId]
//         );
//         const existingMap = new Map(existingCartRes.rows.map(item => [item.product_id, item.quantity]));

//         // Track incoming product IDs for possible cleanup
//         const incomingProductIds = new Set();

//         for (const item of localCart) {
//             const { product_id, quantity } = item;

//             if (!product_id || !quantity || quantity < 1) continue;
//             incomingProductIds.add(product_id);

//             const productExists = await query('SELECT 1 FROM products WHERE id = $1', [product_id]);
//             if (productExists.rows.length === 0) continue;

//             if (existingMap.has(product_id)) {
//                 const existingQty = existingMap.get(product_id);
//                 if (existingQty !== quantity) {
//                     // Update only if quantity is different
//                     await query(
//                         'UPDATE cart_items SET quantity = $1 WHERE cart_id = $2 AND product_id = $3',
//                         [quantity, cartId, product_id]
//                     );
//                 }
//             } else {
//                 // Insert new item
//                 await query(
//                     'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)',
//                     [cartId, product_id, quantity]
//                 );
//             }
//         }

//         // Optionally remove items not in localCart
//         // if (incomingProductIds.size > 0) {
//         //   await query(
//         //     `DELETE FROM cart_items 
//         //      WHERE cart_id = $1 AND product_id NOT IN (${[...incomingProductIds].map((_, i) => `$${i + 2}`).join(', ')})`,
//         //     [cartId, ...incomingProductIds]
//         //   );
//         // }

//         await query('COMMIT');

//         const mergedCart = await query(
//             `SELECT ci.id, p.id as product_id, p.name, p.price, ci.quantity 
//        FROM cart_items ci
//        JOIN products p ON ci.product_id = p.id
//        WHERE ci.cart_id = $1`,
//             [cartId]
//         );

//         res.json({ message: "Cart merged successfully", cart: mergedCart.rows });
//     } catch (error) {
//         await query('ROLLBACK');
//         console.error("Error merging cart:", error);
//         res.status(500).json({ message: "Failed to merge cart" });
//     }
// });

// router.delete("/cart", verifyToken, async (req, res) => {
//   try {
//     const cartId = await getOrCreateCart(req.userId);
//     await query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
//     res.json({ message: "Cart cleared successfully" });
//   } catch (error) {
//     console.error("Error clearing cart:", error);
//     res.status(500).json({ message: "Failed to clear cart" });
//   }
// });

module.exports = router;
const express = require("express");
const router = express.Router();
const { query } = require("./db"); // Import the PostgreSQL connection
const multer = require("multer");
const path = require("path");

const { b2, authorize, getUploadDetails } = require("./b2");
const {uploadUrl, uploadAuthToken} = getUploadDetails
// Use memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage });



const app = express();

app.use("./public/images", express.static(path.join(__dirname, "./public/images"))); // Serve profile images
// app.use("/images", express.static(path.join(__dirname, "../public/images")));

// Get all products (with pagination)
router.get("/products", async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  try {
    // Get products with their images
    const { rows } = await query(`
      SELECT p.*, 
             array_agg(CONCAT(pi.image_path)) as images             
      FROM products p
      LEFT JOIN product_images pi ON p.id = pi.product_id
      GROUP BY p.id
      ORDER BY p.posted_on DESC
    `);

    // Get total count for pagination
    const countResult = await query("SELECT COUNT(*) FROM products");
    const totalResults = parseInt(countResult.rows[0].count);

    res.json({
      page,
      limit,
      totalResults,
      products: rows,
    });
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// Get all products without pagination
router.get("/allProducts", async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT p.*, 
             array_agg(CONCAT(pi.image_path)) as images             
      FROM products p
      LEFT JOIN product_images pi ON p.id = pi.product_id
      GROUP BY p.id
      ORDER BY p.posted_on DESC
    `);

    res.json({
      totalResults: rows.length,
      products: rows,
    });
  } catch (err) {
    console.error("Error fetching all products:", err);
    res.status(500).json({ error: "Failed to fetch all products" });
  }
});

// Get single product by ID
router.get("/products/:id", async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT p.*, 
              COALESCE(
                json_agg(CONCAT(pi.image_path)) FILTER (WHERE pi.image_path IS NOT NULL), 
                '[]'
              ) AS images
       FROM products p
       LEFT JOIN product_images pi ON p.id = pi.product_id
       WHERE p.id = $1
       GROUP BY p.id`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

router.put("/uploadProduct/:id", upload.array("images"), async (req, res) => {
  const { id } = req.params;

  if (!id || isNaN(parseInt(id, 10))) {
    return res.status(400).json({ success: false, message: "Invalid product ID" });
  }

  const productExists = await query("SELECT id FROM products WHERE id = $1", [id]);
  if (productExists.rows.length === 0) {
    return res.status(404).json({ success: false, message: "Product not found" });
  }

  let productData;
  try {
    productData = JSON.parse(req.body.product);
  } catch (err) {
    return res.status(400).json({ success: false, message: "Invalid product data format" });
  }

  const {
    name, category, price, quantity,
    number_in_stock, discount, description, status,
    address, city, color, weight, posted_on,
  } = productData;

  const images = req.files || [];
  let uploadedImages = [];

  try {
    // If new images are uploaded
    if (images.length > 0) {
      await authorize();
      const uploadUrlResponse = await b2.getUploadUrl({
        bucketId: process.env.B2_BUCKET_ID,
      });

      const uploadUrl = uploadUrlResponse.data.uploadUrl;
      const uploadAuthToken = uploadUrlResponse.data.authorizationToken;

      for (const file of images) {
        const fileName = `products/${Date.now()}_${file.originalname}`;
        const uploadResponse = await b2.uploadFile({
          uploadUrl,
          uploadAuthToken,
          fileName,
          data: file.buffer,
          contentType: file.mimetype,
        });

        const imageUrl = `${process.env.B2_BUCKET_URL}apaxt-images/${fileName}`;
        uploadedImages.push(imageUrl);

      
      }
    }

    // 🟢 Now begin database transaction
    await query("BEGIN");

    // Always update product fields
    const { rows } = await query(
      `UPDATE products 
       SET name = $1, category = $2, price = $3, quantity = $4, 
           number_in_stock = $5, discount = $6, description = $7, status = $8,
           address = $9, city = $10, color = $11, weight = $12, posted_on = $13
       WHERE id = $14
       RETURNING *`,
      [
        name, category, price, quantity,
        number_in_stock, discount, description, status,
        address, city, color, weight, posted_on,
        id,
      ]
    );

    // Only if new images were uploaded
    if (uploadedImages.length > 0) {
      // Delete old images from DB
      await query("DELETE FROM product_images WHERE product_id = $1", [id]);

      // Insert new images
      const imageValues = uploadedImages.map(url => `(${id}, '${url}')`).join(",");
      await query(
        `INSERT INTO product_images (product_id, image_path) VALUES ${imageValues}`
      );
    }

    await query("COMMIT");

    res.json({ 
      success: true, 
      product: rows[0],
      message: images.length > 0 ? "Product and images updated" : "Product updated without changing images"
    });

  } catch (err) {
    console.error("Error updating product:", err.response?.data || err);
    await query("ROLLBACK");
    res.status(500).json({ success: false, message: "Failed to update product" });
  }
});


// Delete product
router.delete("/deleteProduct/:id", async (req, res) => {
  try {
    await query("DELETE FROM products WHERE id = $1", [req.params.id]);
    res.json({ message: "Product deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// Like a product
router.patch("/products/:id/like", async (req, res) => {
  const { userId, username } = req.body;

  try {
    // Check if user already liked
    const checkLike = await query(
      "SELECT 1 FROM product_likes WHERE product_id = $1 AND user_id = $2",
      [req.params.id, userId]
    );

    if (checkLike.rows.length > 0) {
      return res.status(400).json({ message: "Already liked" });
    }

    // Transaction for data consistency
    await query("BEGIN");

    // Update likes count
    await query("UPDATE products SET likes = likes + 1 WHERE id = $1", [
      req.params.id,
    ]);

    // Record the like
    await query(
      "INSERT INTO product_likes (product_id, user_id, username) VALUES ($1, $2, $3)",
      [req.params.id, userId, username]
    );

    await query("COMMIT");

    // Get updated like count
    const { rows } = await query("SELECT likes FROM products WHERE id = $1", [
      req.params.id,
    ]);

    res.json({
      message: "Liked",
      likes: rows[0].likes,
    });
  } catch (err) {
    await query("ROLLBACK");
    console.error(err);
    res.status(500).send("Server error");
  }
});

// Dislike a product
router.patch("/products/:id/dislike", async (req, res) => {
  const { userId } = req.body;

  try {
    // Check if user actually liked
    const checkLike = await query(
      "SELECT 1 FROM product_likes WHERE product_id = $1 AND user_id = $2",
      [req.params.id, userId]
    );

    if (checkLike.rows.length === 0) {
      return res.status(400).json({ message: "Not previously liked" });
    }

    await query("BEGIN");

    // Update likes count
    await query("UPDATE products SET likes = likes - 1 WHERE id = $1", [
      req.params.id,
    ]);

    // Remove the like record
    await query(
      "DELETE FROM product_likes WHERE product_id = $1 AND user_id = $2",
      [req.params.id, userId]
    );

    await query("COMMIT");

    // Get updated like count
    const { rows } = await query("SELECT likes FROM products WHERE id = $1", [
      req.params.id,
    ]);

    res.json({
      message: "Disliked",
      likes: rows[0].likes,
    });
  } catch (err) {
    await query("ROLLBACK");
    console.error(err);
    res.status(500).send("Server error");
  }
});

// Search products
router.get("/search", async (req, res) => {
  const searchQuery = req.query.query?.toLowerCase().trim(); // Rename to avoid conflict
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  if (!searchQuery) return res.json([]);

  try {
    // Full-text search with pagination
    const { rows } = await query(
      `SELECT * FROM products 
       WHERE to_tsvector('english', name || ' ' || category || ' ' || brand) 
       @@ to_tsquery('english', $1)
       ORDER BY id
       LIMIT $2 OFFSET $3`,
      [searchQuery.split(" ").join(" | "), limit, offset]
    );

    // Get total count for pagination
    const countResult = await query(
      `SELECT COUNT(*) FROM products 
       WHERE to_tsvector('english', name || ' ' || category || ' ' || brand) 
       @@ to_tsquery('english', $1)`,
      [searchQuery.split(" ").join(" | ")]
    );

    res.json({
      page,
      limit,
      totalResults: parseInt(countResult.rows[0].count),
      results: rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

module.exports = router;

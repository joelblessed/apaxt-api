const express = require("express");
const multer = require("multer");
const path = require("path");
const router = express.Router();
const { query } = require("./db"); // Import PostgreSQL connection

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: "./public/images",
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB file size limit
});

// Route to handle product upload
router.post("/upload", upload.array("images", 11), async (req, res) => {
  try {
    const productData = req.body;
    const files = req.files;

    // Begin transaction
    await query('BEGIN');

    // Insert product into database
    const productResult = await query(
      `INSERT INTO products (
        name, brand, category, price, quantity, 
        number_in_stock, discount, owner, phone_number, 
        description, status, address, likes, city, 
        color, weight, owner_id, location, size, wallet, sub_category
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) 
      RETURNING id`,
      [
        productData.name || null, // Ensure name is not undefined
        JSON.stringify(productData.brand || {}), // Default to empty object if brand is missing
        JSON.stringify(productData.category || {}), // Default to empty object if location is missing

        parseFloat(productData.price) || 0, // Default to 0 if price is missing
        parseInt(productData.quantity) || 0, // Default to 0 if quantity is missing
        parseInt(productData.numberInStock) || 0, // Default to 0 if numberInStock is missing
        parseFloat(productData.discount) || 0, // Default to 0 if discount is missing
        productData.owner || null,
        productData.phoneNumber || null,
        productData.description || null,
        productData.status || null,
        productData.address || null,
        parseInt(productData.likes) || 0, // Default to 0 if likes is missing
        productData.city || null,
        productData.color || null,
        parseFloat(productData.weight) || 0, // Default to 0 if weight is missing
        parseInt(productData.ownerId) || null,
        JSON.stringify(productData.location || {}), // Default to empty object if location is missing
        productData.size || null , // Handle size if not provided
        productData.wallet || 0, // Handle wallet if not provided
        JSON.stringify(productData.subcategory || {}), // Default to empty object if location is missing

      ]
    );

    console.log("Product inserted with ID:", productResult.rows[0].id); // Debug log

    const productId = productResult.rows[0].id;

    // Insert images
    for (const file of files) {
      await query(
        'INSERT INTO product_images (product_id, image_path) VALUES ($1, $2)',
        [productId, `/images/${file.filename}`]
      );
    }

    // Commit transaction
    await query('COMMIT');

    res.json({ 
      message: "Product uploaded successfully!", 
      productId: productId 
    });

  } catch (err) {
    // Rollback transaction on error
    await query('ROLLBACK');
    console.error("Error uploading product:", err);
    res.status(500).json({ error: "Failed to upload product" });
  }
});

module.exports = router;


// // New route to get product with images
// router.get("/:id", async (req, res) => {
//   try {
//     const productId = req.params.id;

//     // Get product with its images
//     const result = await query(`
//       SELECT p.*, 
//              array_agg(pi.image_path) as images
//       FROM products p
//       LEFT JOIN product_images pi ON p.id = pi.product_id
//       WHERE p.id = $1
//       GROUP BY p.id
//     `, [productId]);

//     if (result.rows.length === 0) {
//       return res.status(404).json({ error: "Product not found" });
//     }

//     const product = result.rows[0];
//     // Convert array_agg result (which might be [null] if no images) to empty array
//     product.images = product.images[0] ? product.images : [];

//     res.json(product);
//   } catch (err) {
//     console.error("Error fetching product:", err);
//     res.status(500).json({ error: "Failed to fetch product" });
//   }
// });

// // Route to get all products with their images
router.get("/p", async (req, res) => {
  try {
    const result = await query(`
      SELECT p.*, 
             array_agg(pi.image_path) as images
      FROM products p
      LEFT JOIN product_images pi ON p.id = pi.product_id
      GROUP BY p.id
      ORDER BY p.posted_on DESC
    `);

    // Process the results to handle cases where products have no imagesz
    const products = result.rows.map(product => ({
      ...product,
      images: product.images[0] ? product.images : []
    }));

    // Get total count for pagination
    res.json({products: result});
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});


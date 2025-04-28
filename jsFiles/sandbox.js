const express = require("express");
const router = express.Router();
const { query } = require("./db"); // Import the PostgreSQL connection
const multer = require("multer");
const path = require("path");

// Configure multer to store files on disk
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../public/images")); // Set upload directory
  },
  filename: (req, file, cb) => {
    cb(null, `${file.originalname}`); // Set unique file name
  },
});
const upload = multer({ storage });

const app = express();

app.use("./public/images", express.static(path.join(__dirname, "./public/images"))); // Serve profile images
// app.use("/images", express.static(path.join(__dirname, "../public/images")));




// Update product
router.put("/uploadProduct/:id", upload.array("images"), async (req, res) => {
  const { id } = req.params;

  // Validate ID
  if (!id || isNaN(parseInt(id, 10))) {
    return res.status(400).json({ 
      success: false, 
      message: "Invalid product ID" 
    });
  }

  // Check if product exists
  const productExists = await query("SELECT id FROM products WHERE id = $1", [id]);
  if (productExists.rows.length === 0) {
    return res.status(404).json({ 
      success: false, 
      message: "Product not found" 
    });
  }

  // Parse and validate product data
  let productData;
  try {
    productData = JSON.parse(req.body.product);
  } catch (err) {
    return res.status(400).json({ 
      success: false, 
      message: "Invalid product data format" 
    });
  }

  const {
    name, category, price, quantity,
    number_in_stock, discount, description, status,
    address, city, color, weight, posted_on,
  } = productData;

  const images = req.files || [];

  try {
    await query("BEGIN");

    // Update product details
    const { rows } = await query(
      `UPDATE products 
       SET name = $1, category = $2, price = $3, quantity = $4, 
          number_in_stock = $5, discount = $6, description = $7, status = $8, 
          address = $9, city = $10, color = $11, weight = $12,  
          posted_on = $13
       WHERE id = $14
       RETURNING *`,
      [
        name, category, price, quantity,
        number_in_stock, discount, description, status,
        address, city, color, weight,  posted_on,
        req.params.id,
      ]
    );

  


    if (images.length > 0) {
    await query("DELETE FROM product_images WHERE product_id = $1", [id]);
    }

    // Insert new images (if any)
    if (images.length > 0) {
      const imageValues = images.map(file => {
        const relativePath = `/images/${path.basename(file.path)}`;
        return `(${id}, '${relativePath}')`;
      }).join(",");
      console.log("Image values:", imageValues);
      await query(
        `INSERT INTO product_images (product_id, image_path) VALUES ${imageValues}`
      );
    }

    await query("COMMIT");
    
    res.json({ 
      success: true, 
      product: rows[0] 
    });
  } catch (err) {
    await query("ROLLBACK");
    console.error("Error updating product:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to update product" 
    });
  }
});



module.exports = router;

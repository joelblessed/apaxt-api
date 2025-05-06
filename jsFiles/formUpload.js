const express = require("express");
const multer = require("multer");
const path = require("path");
const router = express.Router();
const { query } = require("./db"); // Import PostgreSQL connection
const B2 = require('backblaze-b2');
const fs = require('fs');
const crypto = require('crypto');

// Configure BackBlaze B2
const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID, // Your B2 Application Key ID
  applicationKey: process.env.B2_APP_KEY,   // Your B2 Application Key
});

// Multer memory storage (no diskStorage now)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB file size limit
});

// Helper to upload file buffer to B2
async function uploadToB2(fileBuffer, fileName, mimeType) {
  await b2.authorize(); // Authorize the account

  const bucketId = process.env.B2_BUCKET_ID; // Your B2 Bucket ID
  const uploadUrlResponse = await b2.getUploadUrl({ bucketId });

  const uploadResponse = await b2.uploadFile({
    uploadUrl: uploadUrlResponse.data.uploadUrl,
    uploadAuthToken: uploadUrlResponse.data.authorizationToken,
    fileName: `products/${fileName}`, // Save inside products/ folder
    data: fileBuffer,
    mime: mimeType,
  });

  // Generate Public URL
  const publicUrl = `${process.env.B2_BUCKET_URL}${process.env.B2_BUCKET_NAME}/products/${fileName}`;
  return publicUrl;
}

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
        name, brand, category,sub_category, price, quantity, 
        number_in_stock, discount, owner,owner_id, phone_number, 
        description, status, address, likes, city, 
        color, weight,  unit_of_weight, size, unit_of_Size, location
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) 
      RETURNING id`,
      [
        productData.name || null,
        JSON.stringify(productData.brand || {}),
        JSON.stringify(productData.category || {}),
        JSON.stringify(productData.subcategory || {}),
        parseFloat(productData.price) || 0,
        parseInt(productData.quantity) || 0,
        parseInt(productData.numberInStock) || 0,
        parseFloat(productData.discount) || 0,
        productData.owner || null,
        productData.ownerId || null,
        productData.phoneNumber || null,
        productData.description || null,
        productData.status || null,
        productData.address || null,
        parseInt(productData.likes) || 0,
        productData.city || null,
        productData.color || null,
        parseFloat(productData.weight) || 0,
        productData.unit_of_weight || null,
        parseFloat(productData.size) || 0,
        productData. unit_of_size|| null,
        JSON.stringify(productData.location || {}),

      ]
    );

    console.log("Product inserted with ID:", productResult.rows[0].id);

    const productId = productResult.rows[0].id;

    // Insert images
    for (const file of files) {
      const randomName = crypto.randomBytes(16).toString('hex') + path.extname(file.originalname);
      const publicUrl = await uploadToB2(file.buffer, randomName, file.mimetype);

      await query(
        'INSERT INTO product_images (product_id, image_path) VALUES ($1, $2)',
        [productId, publicUrl]
      );
    }

    // Commit transaction
    await query('COMMIT');

    res.json({ 
      message: "Product uploaded successfully!", 
      productId: productId 
    });

  } catch (err) {
    await query('ROLLBACK');
    console.error("Error uploading product:", err);
    res.status(500).json({ error: "Failed to upload product" });
  }
});

module.exports = router;
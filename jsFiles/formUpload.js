const express = require("express");
const multer = require("multer");
const path = require("path");
const router = express.Router();
const { query } = require("./db");
const B2 = require('backblaze-b2');
const crypto = require('crypto');
const sharp = require("sharp");
const jwt = require("jsonwebtoken");

// B2 config
const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID,
  applicationKey: process.env.B2_APP_KEY,
});

const storage = multer.memoryStorage();
const upload = multer({ 
  storage, 
  limits: { 
    fileSize: 50 * 1024 * 1024,
    files: 10 // Max 10 files
  },
  fileFilter: (req, file, cb) => {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (validTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
    }
  }
});

// Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.error("JWT Error:", err.message);
      return res.status(403).json({ message: "Invalid token" });
    }
    req.user = user;
    next();
  });
}

// Upload helper functions
async function uploadToB2(fileBuffer, fileName, mimeType) {
  await b2.authorize();
  const bucketId = process.env.B2_BUCKET_ID;
  const uploadUrlRes = await b2.getUploadUrl({ bucketId });

  const uploadResponse = await b2.uploadFile({
    uploadUrl: uploadUrlRes.data.uploadUrl,
    uploadAuthToken: uploadUrlRes.data.authorizationToken,
    fileName: `products/${fileName}`,
    data: fileBuffer,
    mime: mimeType,
  });

  return `${process.env.B2_BUCKET_URL}${process.env.B2_BUCKET_NAME}/products/${fileName}`;
}

async function generateAndUploadThumbnail(fileBuffer, fileName, mimeType) {
  const thumbnailBuffer = await sharp(fileBuffer)
    .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
    .toBuffer();
  const thumbnailName = `thumbnails/${fileName}`;
  return await uploadToB2(thumbnailBuffer, thumbnailName, mimeType);
}

// POST /api/products/upload
router.post("/upload", authenticateToken, upload.array("images", 10), async (req, res) => {
  const user = req.user;
  const formData = JSON.parse(req.body.product);

  const {
    name_en, name_fr,
    description_en, description_fr,
    brand, category, dimensions, attributes,
    price, number_in_stock, discount,
    phone_number, status, address, city, colors
  } = formData
  if (!name_en || !price || !user.userId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    await query("BEGIN");

    let productId;

    const parsedBrand = JSON.stringify(JSON.parse(brand || "{}"));
    const parsedCategory = JSON.stringify(JSON.parse(category || "{}"));

    // 1. Check if product with same name_en OR name_fr, brand, and category exists
    const existing = await query(`
      SELECT pt.product_id FROM product_translations pt
      JOIN products p ON p.id = pt.product_id
      WHERE (
        (pt.name = $1 AND pt.language_code = 'en') OR
        (pt.name = $2 AND pt.language_code = 'fr')
      )
      AND p.brand::jsonb = $3::jsonb
      AND p.category::jsonb = $4::jsonb
      LIMIT 1
    `, [name_en, name_fr, parsedBrand, parsedCategory]);

    if (existing.rows.length > 0) {
      productId = existing.rows[0].product_id;
    } else {
      // 2. Insert into products
      const productRes = await query(
        `INSERT INTO products (brand, category, dimensions, attributes, thumbnail_index)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          parsedBrand,
          parsedCategory,
          thumbnail_index,
          JSON.stringify(JSON.parse(dimensions || "{}")),
          JSON.stringify(JSON.parse(attributes || "{}"))
        ]
      );
      productId = productRes.rows[0].id;

      // 3. Insert translations
      await query(
        `INSERT INTO product_translations (product_id, language_code, name, description)
         VALUES ($1, 'en', $2, $3)`,
        [productId, name_en, description_en]
      );

      if (name_fr) {
        await query(
          `INSERT INTO product_translations (product_id, language_code, name, description)
           VALUES ($1, 'fr', $2, $3)`,
          [productId, name_fr, description_fr]
        );
      }
    }

    // 4. Insert into user_products
    const listingRes = await query(
      `INSERT INTO user_products (
        product_id, owner, owner_id, price, number_in_stock, 
        discount, phone_number, status, address, city, colors
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
      RETURNING id`,
      [
        productId,
        user.username,
        user.userId,
        parseFloat(price),
        parseInt(number_in_stock) || 1,
        parseFloat(discount) || 0,
        phone_number || null,
        status || 'New',
        address || null,
        city || null,
        colors ? colors.split(',') : []
      ]
    );

    // 5. Handle image uploads
    const imageUrls = [];
    for (const file of req.files) {
      const fileName = crypto.randomBytes(16).toString("hex") + path.extname(file.originalname);
      const imageUrl = await uploadToB2(file.buffer, fileName, file.mimetype);
      const thumbUrl = await generateAndUploadThumbnail(file.buffer, fileName, file.mimetype);

      await query(
        `INSERT INTO product_images (product_id, image_path, thumbnail_path)
         VALUES ($1, $2, $3)`,
        [productId, imageUrl, thumbUrl]
      );
      imageUrls.push(imageUrl);
    }

    await query("COMMIT");

    res.status(201).json({
      success: true,
      productId,
      listingId: listingRes.rows[0].id,
      images: imageUrls,
      message: existing.rows.length > 0
        ? "Existing product reused. User-specific listing created."
        : "New product created successfully."
    });

  } catch (err) {
    await query("ROLLBACK");
    console.error("Product upload error:", err);
    res.status(500).json({
      error: "Failed to upload product",
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});


// GET product with translations
// router.get("/:id", async (req, res) => {
//   const { id } = req.params;
//   const acceptLanguage = req.headers['accept-language'] || 'en';

//   try {
//     // Get base product data
//     const productRes = await query(
//       `SELECT * FROM products WHERE id = $1`, 
//       [id]
//     );

//     if (productRes.rows.length === 0) {
//       return res.status(404).json({ error: "Product not found" });
//     }

//     // Get translations - prefer requested language, fallback to English
//     const translationsRes = await query(
//       `SELECT * FROM product_translations 
//        WHERE product_id = $1 
//        ORDER BY language_code = $2 DESC, language_code = 'en' DESC`,
//       [id, acceptLanguage.split('-')[0]]
//     );

//     if (translationsRes.rows.length === 0) {
//       return res.status(404).json({ error: "Product translations not found" });
//     }

//     // Get user listings
//     const listingsRes = await query(
//       `SELECT * FROM user_products WHERE product_id = $1`,
//       [id]
//     );

//     // Get images
//     const imagesRes = await query(
//       `SELECT image_path, thumbnail_path FROM product_images 
//        WHERE product_id = $1 ORDER BY id`,
//       [id]
//     );

//     // Format response
//     const response = {
//       product: {
//         ...productRes.rows[0],
//         translations: translationsRes.rows,
//         currentTranslation: translationsRes.rows[0], // Best match based on language
//       },
//       listings: listingsRes.rows,
//       images: imagesRes.rows
//     };

//     res.json(response);

//   } catch (err) {
//     console.error("Product fetch error:", err);
//     res.status(500).json({ error: "Failed to fetch product" });
//   }
// });

// Search products with translations
// router.get("/search", async (req, res) => {
//   const { query: searchTerm, lang = 'en' } = req.query;
//   const page = parseInt(req.query.page) || 1;
//   const limit = Math.min(100, parseInt(req.query.limit) || 10);
//   const offset = (page - 1) * limit;

//   if (!searchTerm || searchTerm.length < 2) {
//     return res.status(400).json({ error: "Search term must be at least 2 characters" });
//   }

//   try {
//     // Full-text search on translations
//     const searchRes = await query(
//       `SELECT 
//          p.*,
//          pt.name,
//          pt.description,
//          pt.language_code,
//          (SELECT array_agg(pi.image_path) FROM product_images pi WHERE pi.product_id = p.id LIMIT 1) as images,
//          COUNT(*) OVER() as total_count
//        FROM products p
//        JOIN product_translations pt ON p.id = pt.product_id
//        WHERE pt.language_code = $1
//        AND to_tsvector('english', pt.name || ' ' || COALESCE(pt.description, '')) 
//            @@ to_tsquery('english', $2)
//        ORDER BY ts_rank(
//          to_tsvector('english', pt.name || ' ' || COALESCE(pt.description, '')),
//          to_tsquery('english', $2)
//        ) DESC
//        LIMIT $3 OFFSET $4`,
//       [lang, searchTerm.split(' ').join(' & '), limit, offset]
//     );

//     const totalCount = searchRes.rows[0]?.total_count || 0;

//     res.json({
//       results: searchRes.rows,
//       pagination: {
//         page,
//         limit,
//         totalCount,
//         totalPages: Math.ceil(totalCount / limit)
//       }
//     });

//   } catch (err) {
//     console.error("Search error:", err);
//     res.status(500).json({ error: "Search failed" });
//   }
// });

module.exports = router; 
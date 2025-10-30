-- 1) users must come first
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL       PRIMARY KEY,
  email      VARCHAR(100) NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,
  user_name  VARCHAR(100),
  full_name  VARCHAR(255),
  created_at TIMESTAMP    DEFAULT NOW()
);

-- 2) products (now users(id) exists)
CREATE TABLE IF NOT EXISTS products (
  id          SERIAL       PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  price       DECIMAL(10,2) CHECK (price > 0),
  description TEXT,
  category    VARCHAR(50),
  brand       VARCHAR(50),
  owner_id    INTEGER      REFERENCES users(id),
  likes       INTEGER      DEFAULT 0,
  created_at  TIMESTAMP    DEFAULT NOW()
);

-- 3) product_likes (references products)
CREATE TABLE IF NOT EXISTS product_likes (
  id          SERIAL       PRIMARY KEY,
  product_id  INTEGER      REFERENCES products(id) ON DELETE CASCADE,
  user_id     INTEGER      NOT NULL,
  username    VARCHAR(100) NOT NULL,
  liked_at    TIMESTAMP    DEFAULT NOW(),
  UNIQUE (product_id, user_id)
);

CREATE TABLE product_likes (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  username VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (product_id, user_id)  -- Ensures a user can like a product only once
);

-- Create an index for faster queries on likes
CREATE INDEX idx_product_likes_product ON product_likes(product_id);
CREATE INDEX idx_product_likes_user ON product_likes(user_id);

-- 4) full‑text search index (complete the to_tsvector call)
CREATE INDEX IF NOT EXISTS idx_products_search
  ON products
  USING GIN(to_tsvector('english', name || ' ' || category || ' ' || brand));

-- 5) likes lookup index
CREATE INDEX IF NOT EXISTS idx_product_likes
  ON product_likes(product_id, user_id);

-- 6) product_images (references products)
CREATE TABLE IF NOT EXISTS product_images (
  id          SERIAL       PRIMARY KEY,
  product_id  INTEGER      REFERENCES products(id) ON DELETE CASCADE,
  image_path TEXT NOT NULL,
  uploaded_at TIMESTAMP    DEFAULT NOW()
);

-- CREATE TABLE products (
--   id SERIAL PRIMARY KEY,
--   name TEXT,
--   price NUMERIC,
--   category TEXT,
--   created_at TIMESTAMP DEFAULT NOW()
-- );




const express = require("express");
const router = express.Router();
const { query } = require("./db");
const multer = require("multer");
const path = require("path");
const sharp = require("sharp");
const { b2, authorize, getUploadDetails } = require("./b2");

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 10 // Max 10 files
  },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'), false);
    }
  }
});

// Helper function for transactions
async function runTransaction(queries) {
  await query('BEGIN');
  try {
    const results = [];
    for (const q of queries) {
      const { text, values } = q;
      const res = await query(text, values);
      results.push(res);
    }
    await query('COMMIT');
    return results;
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
}

// Get all products (with pagination)
router.get("/products", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;
    const language = req.query.lang || 'en'; // Default to English

    // Get products with their translations, images, and listings
    const { rows } = await query(`
      SELECT 
        p.*,
        (SELECT json_agg(t) FROM (
          SELECT * FROM product_translations pt 
          WHERE pt.product_id = p.id AND pt.language_code = $3
        ) t) AS translations,
        json_agg(DISTINCT up.*) FILTER (WHERE up.id IS NOT NULL) AS user_products,
        array_agg(DISTINCT pi.image_path) FILTER (WHERE pi.image_path IS NOT NULL) AS images,
        array_agg(DISTINCT pi.thumbnail_path) FILTER (WHERE pi.thumbnail_path IS NOT NULL) AS thumbnails
      FROM products p
      LEFT JOIN user_products up ON p.id = up.product_id
      LEFT JOIN product_images pi ON p.id = pi.product_id
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset, language]);

    // Get total count for pagination
    const countResult = await query("SELECT COUNT(*) FROM products");
    const totalResults = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      page,
      limit,
      totalPages: Math.ceil(totalResults / limit),
      totalResults,
      products: rows,
    });
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({ success: false, error: "Failed to fetch products" });
  }
});

// Get single product by ID
router.get("/products/:id", async (req, res) => {
  try {
    const language = req.query.lang || 'en'; // Default to English

    const { rows } = await query(`
      SELECT 
        p.*,
        (SELECT json_agg(t) FROM (
          SELECT * FROM product_translations pt 
          WHERE pt.product_id = p.id AND pt.language_code = $2
        ) t) AS translations,
        json_agg(DISTINCT up.*) FILTER (WHERE up.id IS NOT NULL) AS user_products,
        array_agg(DISTINCT pi.image_path) FILTER (WHERE pi.image_path IS NOT NULL) AS images,
        array_agg(DISTINCT pi.thumbnail_path) FILTER (WHERE pi.thumbnail_path IS NOT NULL) AS thumbnails
      FROM products p
      LEFT JOIN user_products up ON p.id = up.product_id
      LEFT JOIN product_images pi ON p.id = pi.product_id
      WHERE p.id = $1
      GROUP BY p.id
    `, [req.params.id, language]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    res.json({ 
      success: true, 
      product: {
        ...rows[0],
        current_translation: rows[0].translations?.[0] || null
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// Create new product with images
router.post("/products", upload.array("images"), async (req, res) => {
  try {
    const productData = JSON.parse(req.body.product);
    const { 
      name_en, name_fr, // Required: name_en
      description_en, description_fr,
      brand, category, dimensions, attributes,
      owner, owner_id, price, number_in_stock,
      discount, phone_number, status, address, city, colors
    } = productData;

    // Validate required fields
    if (!name_en || !owner_id || !price) {
      return res.status(400).json({ 
        success: false, 
        message: "English name, owner_id, and price are required" 
      });
    }

    // Process image uploads if they exist
    let uploadedImages = [];
    let uploadedThumbnails = [];
    const images = req.files || [];

    if (images.length > 0) {
      await authorize();
      const uploadUrlResponse = await b2.getUploadUrl({
        bucketId: process.env.B2_BUCKET_ID,
      });

      const { uploadUrl, authorizationToken } = uploadUrlResponse.data;

      for (const file of images) {
        const fileName = products/${Date.now()}_${file.originalname};
        const thumbnailName = products/thumbnails/${Date.now()}_${file.originalname};

        // Generate thumbnail
        const thumbnailBuffer = await sharp(file.buffer)
          .resize(200, 200)
          .toBuffer();

        // Upload original
        await b2.uploadFile({
          uploadUrl,
          uploadAuthToken: authorizationToken,
          fileName,
          data: file.buffer,
          contentType: file.mimetype,
        });

        // Upload thumbnail
        await b2.uploadFile({
          uploadUrl,
          uploadAuthToken: authorizationToken,
          fileName: thumbnailName,
          data: thumbnailBuffer,
          contentType: file.mimetype,
        });

        uploadedImages.push(${process.env.B2_BUCKET_URL}${process.env.B2_BUCKET_NAME}/${fileName});
        uploadedThumbnails.push(${process.env.B2_BUCKET_URL}${process.env.B2_BUCKET_NAME}/${thumbnailName});
      }
    }

    // Start transaction
    const results = await runTransaction([
      // Insert main product (language-independent data)
      {
        text: `
          INSERT INTO products (brand, category, dimensions, attributes)
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `,
        values: [
          JSON.stringify(brand || {}),
          JSON.stringify(category || {}),
          JSON.stringify(dimensions || {}),
          JSON.stringify(attributes || {})
        ]
      },
      // Insert English translation (required)
      {
        text: `
          INSERT INTO product_translations 
          (product_id, language_code, name, description)
          VALUES ($1, 'en', $2, $3)
        `,
        values: ['placeholder', name_en, description_en]
      },
      // Insert French translation if provided
      ...(name_fr ? [{
        text: `
          INSERT INTO product_translations 
          (product_id, language_code, name, description)
          VALUES ($1, 'fr', $2, $3)
        `,
        values: ['placeholder', name_fr, description_fr]
      }] : []),
      // Insert user_product relationship
      {
        text: `
          INSERT INTO user_products (
            product_id, owner, owner_id, price, number_in_stock, 
            discount, phone_number, status, address, city, colors
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *
        `,
        values: [
          'placeholder', 
          owner, 
          owner_id, 
          parseFloat(price),
          parseInt(number_in_stock) || 1,
          parseFloat(discount) || 0,
          phone_number,
          status || 'available',
          address,
          city,
          colors ? colors.split(',') : []
        ]
      },
      // Insert images if any
      ...(uploadedImages.length > 0 ? [{
        text: `
          INSERT INTO product_images (product_id, image_path, thumbnail_path)
          VALUES ${uploadedImages.map((_, i) => ('placeholder', $${i*2+1}, $${i*2+2})).join(',')}
        `,
        values: uploadedImages.flatMap((img, i) => [img, uploadedThumbnails[i]])
      }] : [])
    ]);

    // Replace placeholder with actual product_id
    const productId = results[0].rows[0].id;
    results[1].values[0] = productId;
    if (name_fr) results[2].values[0] = productId;
    results[name_fr ? 3 : 2].values[0] = productId;
    if (uploadedImages.length > 0) {
      results[name_fr ? 4 : 3].values = results[name_fr ? 4 : 3].values.map(v => 
        v === 'placeholder' ? productId : v
      );
    }

    res.status(201).json({ 
      success: true, 
      productId,
      listing: results[name_fr ? 3 : 2].rows[0],
      images: uploadedImages 
    });
  } catch (err) {
    console.error("Error creating product:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to create product",
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Search products with translations
router.get("/products/search", async (req, res) => {
  try {
    const searchQuery = req.query.query?.trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;
    const language = req.query.lang || 'en';

    if (!searchQuery || searchQuery.length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: "Search query must be at least 2 characters" 
      });
    }

    const tsQuery = searchQuery.split(/\s+/).join(" | ");

    // Search in product translations
    const { rows } = await query(`
      SELECT 
        p.*,
        pt.name,
        pt.description,
        array_agg(DISTINCT pi.image_path) FILTER (WHERE pi.image_path IS NOT NULL) AS images,
        COUNT(*) OVER() as total_count,
        ts_rank_cd(
          to_tsvector('english', pt.name || ' ' || COALESCE(pt.description, '')),
          to_tsquery('english', $1)
        ) AS rank
      FROM products p
      JOIN product_translations pt ON p.id = pt.product_id
      LEFT JOIN product_images pi ON p.id = pi.product_id
      WHERE pt.language_code = $2
      AND to_tsvector('english', pt.name || ' ' || COALESCE(pt.description, '')) 
          @@ to_tsquery('english', $1)
      GROUP BY p.id, pt.id
      ORDER BY rank DESC
      LIMIT $3 OFFSET $4
    `, [tsQuery, language, limit, offset]);

    const totalResults = rows[0]?.total_count || 0;

    res.json({
      success: true,
      query: searchQuery,
      page,
      limit,
      totalPages: Math.ceil(totalResults / limit),
      totalResults,
      results: rows.map(row => {
        const { total_count, ...rest } = row;
        return rest;
      }),
    });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ success: false, error: "Search failed" });
  }
});

// Other routes (update, delete, like, etc.) would need similar updates
// to handle the multilingual schema properly...

module.exports = router;
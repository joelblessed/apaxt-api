const express = require("express");
const router = express.Router();
const { query } = require("./db");
const multer = require("multer");
const path = require("path");
const sharp = require("sharp");
const { b2, authorize, getUploadDetails } = require("./b2");

const jwt = require("jsonwebtoken");
const fallbackImage = "https://f004.backblazeb2.com/file/apaxt-images/products/logo.png";


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

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 10, // Max 10 files
  },
  fileFilter: (req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error("Invalid file type. Only JPEG, PNG, and WebP are allowed."),
        false
      );
    }
  },
});

// Helper function for transactions
async function runTransaction(queries) {
  await query("BEGIN");
  try {
    const results = [];
    for (const q of queries) {
      const { text, values } = q;
      const res = await query(text, values);
      results.push(res);
    }
    await query("COMMIT");
    return results;
  } catch (err) {
    await query("ROLLBACK");
    throw err;
  }
}



// router.get("/allProducts", async (req, res) => {
//   try {
//     const language = req.query.lang || "en"; // Default language

//     const { rows } = await query(
//       `
//       SELECT 
//         p.id,
//         p.brand,
//         p.category,
//         p.dimensions,
//         p.attributes,
//         p.created_at,
//         p.thumbnail_index,
//         pt.name,
//         pt.description,

//         -- Include user-specific product rows as JSON array
//         json_agg(DISTINCT up.*) FILTER (WHERE up.id IS NOT NULL) AS user_products,

//         -- Include images with thumbnails as JSON array
//         json_agg(DISTINCT jsonb_build_object(
//           'image_path', pi.image_path,
//           'thumbnail_path', pi.thumbnail_path
//         )) FILTER (WHERE pi.image_path IS NOT NULL) AS images

//       FROM products p
//       JOIN product_translations pt 
//         ON p.id = pt.product_id AND pt.language_code = $1
//       LEFT JOIN user_products up 
//         ON p.id = up.product_id
//       LEFT JOIN product_images pi 
//         ON p.id = pi.product_id

//       GROUP BY p.id, pt.name, pt.description
//       ORDER BY p.created_at DESC
//       `,
//       [language]
//     );


//     res.json({
//       success: true,
//       totalResults: rows.length,
//       products: rows.map((product) => {
//         const imageObjects = product.images || [];

//         const images = imageObjects.map((img) => img.image_path);
//         const thumbnails = imageObjects.map((img) => img.thumbnail_path);

//         return {
//           ...product,
//           images: images.length ? images : [fallbackImage],
//           thumbnails: thumbnails.length ? thumbnails : [fallbackImage],
//           primaryImage: images[0] || fallbackImage,
//           thumbnail: thumbnails[0] || fallbackImage,
//         };
//       }),
//     });
//   } catch (err) {
//     console.error("Error fetching all products:", err);
//     res.status(500).json({
//       success: false,
//       error: "Failed to fetch products",
//       details: process.env.NODE_ENV === "development" ? err.message : undefined,
//     });
//   }
// });



// Get all products with pagination and translations
router.get("/products", async (req, res) => {
  try {
    const language = req.query.lang || "en";
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 1000);
    const offset = (page - 1) * limit;

    // Query with joined user_products and image data
    const productsQuery = `
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
            'product_id',up.product_id,
            'price', up.price,
            'discount', up.discount,
            'status', up.status,
            'colors', up.colors,
            'owner', up.owner,
            'owner_id',up.owner_id,
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
      ORDER BY p.created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(*) 
      FROM products p
      JOIN product_translations pt 
        ON p.id = pt.product_id AND pt.language_code = $1
    `;

    const [productsResult, countResult] = await Promise.all([
      query(productsQuery, [language, limit, offset]),
      query(countQuery, [language]),
    ]);

    const totalResults = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalResults / limit);

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
      pagination: {
        currentPage: page,
        totalPages,
        totalResults,
        resultsPerPage: limit,
      },
      products
    });

  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch products",
      ...(process.env.NODE_ENV === "development" && { details: err.message }),
    });
  }
});

//fetch by id
router.get("/userProducts", async (req, res) => {
  try {
    const language = req.query.lang || "en";
    const ownerId = req.query.owner_id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 1000);
    const offset = (page - 1) * limit;

    if (!ownerId) {
      return res.status(400).json({
        success: false,
        error: "Missing owner_id in query parameters",
      });
    }


    const productsQuery = `
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
          WHERE up.product_id = p.id AND up.owner_id = $2
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
      WHERE EXISTS (
        SELECT 1 FROM user_products up 
        WHERE up.product_id = p.id AND up.owner_id = $2
      )
      ORDER BY p.created_at DESC
      LIMIT $3 OFFSET $4
    `;

    const countQuery = `
      SELECT COUNT(*) 
      FROM products p
      JOIN product_translations pt 
        ON p.id = pt.product_id AND pt.language_code = $1
      WHERE EXISTS (
        SELECT 1 FROM user_products up 
        WHERE up.product_id = p.id AND up.owner_id = $2
      )
    `;

    const [productsResult, countResult] = await Promise.all([
      query(productsQuery, [language, ownerId, limit, offset]),
      query(countQuery, [language, ownerId]),
    ]);

    const totalResults = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalResults / limit);

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
      pagination: {
        currentPage: page,
        totalPages,
        totalResults,
        resultsPerPage: limit,
      },
      products
    });

  } catch (err) {
    console.error("Error fetching products by owner_id:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch products",
      ...(process.env.NODE_ENV === "development" && { details: err.message }),
    });
  }
});

// router.get("/allUserProducts", async (req, res) => {
//   try {
//     const language = req.query.lang || "en";
//     const ownerId = req.query.owner_id;

//     if (!ownerId) {
//       return res.status(400).json({
//         success: false,
//         error: "Missing owner_id in query parameters",
//       });
//     }


//     const productsQuery = `
//       SELECT 
//         p.id,
//         p.brand,
//         p.category,
//         p.dimensions,
//         p.attributes,
//         p.created_at,
//         p.thumbnail_index,
//         pt.name,
//         pt.description,
//         (
//           SELECT jsonb_agg(jsonb_build_object(
//             'id', up.id,
//             'price', up.price,
//             'discount', up.discount,
//             'status', up.status,
//             'colors', up.colors,
//             'owner', up.owner,
//             'owner_id', up.owner_id,
//             'number_in_stock', up.number_in_stock,
//             'phone_number', up.phone_number,
//             'address', up.address,
//             'city', up.city
//           ))
//           FROM user_products up 
//           WHERE up.product_id = p.id AND up.owner_id = $2
//         ) AS user_products,
//         (
//           SELECT jsonb_agg(jsonb_build_object(
//             'image_path', pi.image_path,
//             'thumbnail_path', pi.thumbnail_path
//           ))
//           FROM product_images pi
//           WHERE pi.product_id = p.id
//         ) AS imagespath
//       FROM products p
//       JOIN product_translations pt 
//         ON p.id = pt.product_id AND pt.language_code = $1
//       WHERE EXISTS (
//         SELECT 1 FROM user_products up 
//         WHERE up.product_id = p.id AND up.owner_id = $2
//       )
//       ORDER BY p.created_at DESC
//     `;

//     const productsResult = await query(productsQuery, [language, ownerId]);

//     const products = productsResult.rows.map((product) => {
//       const imageData = product.imagespath || [];

//       const images = imageData.map(img => img.image_path).filter(Boolean);
//       const thumbnails = imageData.map(img => img.thumbnail_path).filter(Boolean);

//       return {
//         ...product,
//         images: images.length ? images : [fallbackImage],
//         thumbnails: thumbnails.length ? thumbnails : [fallbackImage],
//         primaryImage: images[0] || fallbackImage,
//         thumbnail: thumbnails[0] || fallbackImage,
//       };
//     });

//     res.json({
//       success: true,
//       products,
//       totalResults: products.length
//     });

//   } catch (err) {
//     console.error("Error fetching products by owner_id:", err);
//     res.status(500).json({
//       success: false,
//       error: "Failed to fetch products",
//       ...(process.env.NODE_ENV === "development" && { details: err.message }),
//     });
//   }
// });

// router.get("/allUserProducts", async (req, res) => {
//   try {
//     const language = req.query.lang || "en";
//     const ownerId = req.query.owner_id;
//     const page = Math.max(1, parseInt(req.query.page) || 1);
//     const limit = Math.min(100, parseInt(req.query.limit) || 1000);
//     const offset = (page - 1) * limit;

//     if (!ownerId) {
//       return res.status(400).json({
//         success: false,
//         error: "Missing owner_id in query parameters",
//       });
//     }

//     const productsQuery = `
//       SELECT 
//         p.id,
//         p.brand,
//         p.category,
//         p.dimensions,
//         p.attributes,
//         p.created_at,
//         p.thumbnail_index,
//         pt.name,
//         pt.description,
//         (
//           SELECT jsonb_agg(jsonb_build_object(
//             'id', up.id,
//             'price', up.price,
//             'discount', up.discount,
//             'status', up.status,
//             'colors', up.colors,
//             'owner', up.owner,
//             'owner_id', up.owner_id,
//             'number_in_stock', up.number_in_stock,
//             'phone_number', up.phone_number,
//             'address', up.address,
//             'city', up.city
//           ))
//           FROM user_products up 
//           WHERE up.product_id = p.id AND up.owner_id = $2
//         ) AS user_products,
//         (
//           SELECT jsonb_agg(jsonb_build_object(
//             'image_path', pi.image_path,
//             'thumbnail_path', pi.thumbnail_path
//           ))
//           FROM product_images pi
//           WHERE pi.product_id = p.id
//         ) AS imagespath
//       FROM products p
//       JOIN product_translations pt 
//         ON p.id = pt.product_id AND pt.language_code = $1
//       WHERE EXISTS (
//         SELECT 1 FROM user_products up 
//         WHERE up.product_id = p.id AND up.owner_id = $2
//       )
//       ORDER BY p.created_at DESC
//       LIMIT $3 OFFSET $4
//     `;

//     const countQuery = `
//       SELECT COUNT(*) 
//       FROM products p
//       JOIN product_translations pt 
//         ON p.id = pt.product_id AND pt.language_code = $1
//       WHERE EXISTS (
//         SELECT 1 FROM user_products up 
//         WHERE up.product_id = p.id AND up.owner_id = $2
//       )
//     `;

//     const [productsResult, countResult] = await Promise.all([
//       query(productsQuery, [language, ownerId, limit, offset]),
//       query(countQuery, [language, ownerId]),
//     ]);

//     const totalResults = parseInt(countResult.rows[0].count, 10);
//     const totalPages = Math.ceil(totalResults / limit);

//     const products = productsResult.rows.map((product) => {
//       const imageData = product.imagespath || [];

//       const images = imageData.map(img => img.image_path).filter(Boolean);
//       const thumbnails = imageData.map(img => img.thumbnail_path).filter(Boolean);

//       return {
//         ...product,
//         images: images.length ? images : [fallbackImage],
//         thumbnails: thumbnails.length ? thumbnails : [fallbackImage],
//         primaryImage: images[0] || fallbackImage,
//         thumbnail: thumbnails[0] || fallbackImage,
//       };
//     });

//     res.json({
//       success: true,
//       pagination: {
//         currentPage: page,
//         totalPages,
//         totalResults,
//         resultsPerPage: limit,
//       },
//       products
//     });

//   } catch (err) {
//     console.error("Error fetching products by owner_id:", err);
//     res.status(500).json({
//       success: false,
//       error: "Failed to fetch products",
//       ...(process.env.NODE_ENV === "development" && { details: err.message }),
//     });
//   }
// });


// // Get single product by ID



// router.get("/product/:id", async (req, res) => {
//   try {
//     const productId = req.params.id;
//     const language = req.query.lang || "en";

//     const queryText = `
//       SELECT 
//         p.id,
//         p.brand,
//         p.category,
//         p.dimensions,
//         p.attributes,
//         p.thumbnail_index,
//         p.created_at,

//         -- Translation
//         (
//           SELECT row_to_json(pt)
//           FROM product_translations pt
//           WHERE pt.product_id = p.id AND pt.language_code = $2
//           LIMIT 1
//         ) AS current_translation,

//         -- User products
//         (
//           SELECT json_agg(jsonb_build_object(
//             'id', up.id,
//             'price', up.price,
//             'discount', up.discount,
//             'status', up.status,
//             'colors', up.colors,
//             'owner', up.owner,
//             'number_in_stock', up.number_in_stock,
//             'phone_number', up.phone_number,
//             'address', up.address,
//             'city', up.city
//           ))
//           FROM user_products up
//           WHERE up.product_id = p.id
//         ) AS user_products,

//         -- Product images
//         (
//           SELECT json_agg(jsonb_build_object(
//             'image_path', pi.image_path,
//             'thumbnail_path', pi.thumbnail_path
//           ))
//           FROM product_images pi
//           WHERE pi.product_id = p.id
//         ) AS images_data

//       FROM products p
//       WHERE p.id = $1
//       LIMIT 1
//     `;

//     const { rows } = await query(queryText, [productId, language]);

//     if (rows.length === 0) {
//       return res.status(404).json({ success: false, message: "Product not found" });
//     }

//     const product = rows[0];
//     const imageData = product.images_data || [];

//     const images = imageData.map(img => img.image_path).filter(Boolean);
//     const thumbnails = imageData.map(img => img.thumbnail_path).filter(Boolean);

//     res.json({
//       success: true,
//       product: {
//         id: product.id,
//         brand: product.brand,
//         category: product.category,
//         dimensions: product.dimensions,
//         attributes: product.attributes,
//         created_at: product.created_at,
//         current_translation: product.current_translation || null,
//         user_products: product.user_products || [],
//         images: images.length ? images : [fallbackImage],
//         thumbnails: thumbnails.length ? thumbnails : [fallbackImage],
//         primaryImage: images[0] || fallbackImage,
//         thumbnail: thumbnails[0] || fallbackImage
//       }
//     });

//   } catch (err) {
//     console.error("Error fetching product:", err);
//     res.status(500).json({ success: false, error: "Server error" });
//   }
// });




//// Get single product by ID all Languages
// router.get("/productPrev/:productId/:userId", async (req, res) => {
//   try {
//     const { productId, userId } = req.params;

//     const { rows } = await query(
//       `
//       SELECT 
//         p.*,

//         -- All translations
//         (
//           SELECT json_agg(json_build_object(
//             'language_code', pt.language_code,
//             'name', pt.name,
//             'description', pt.description
//           ))
//           FROM product_translations pt 
//           WHERE pt.product_id = p.id
//         ) AS translations,

//         -- Filter user_products by owner_id
//         (
//           SELECT json_agg(up)
//           FROM user_products up
//           WHERE up.product_id = p.id AND up.owner_id = $2
//         ) AS user_products,

//         -- Images
//         array_agg(DISTINCT pi.image_path) FILTER (WHERE pi.image_path IS NOT NULL) AS images,
//         array_agg(DISTINCT pi.thumbnail_path) FILTER (WHERE pi.thumbnail_path IS NOT NULL) AS thumbnails

//       FROM products p
//       LEFT JOIN product_images pi ON p.id = pi.product_id
//       WHERE p.id = $1
//       GROUP BY p.id
//       `,
//       [productId, userId]
//     );

//     if (rows.length === 0) {
//       return res.status(404).json({ success: false, message: "Product not found" });
//     }

//     const product = rows[0];
//     const language = req.query.lang || "en";

//     const currentTranslation = product.translations?.find(
//       (t) => t.language_code === language
//     ) || null;

//     res.json({
//       success: true,
//       product: {
//         ...product,
//         current_translation: currentTranslation
//       }
//     });
//   } catch (err) {
//     console.error("Error fetching product:", err);
//     res.status(500).json({ success: false, error: "Server error" });
//   }
// });


// Create new product with images
// router.post("/products", upload.array("images"), async (req, res) => {
//   try {
//     const productData = JSON.parse(req.body.product);
//     const {
//       name_en,
//       name_fr, // Required: name_en
//       description_en,
//       description_fr,
//       brand,
//       category,
//       dimensions,
//       attributes,
//       owner,
//       owner_id,
//       price,
//       number_in_stock,
//       discount,
//       phone_number,
//       status,
//       address,
//       city,
//       colors,
//     } = productData;

//     // Validate required fields
//     if (!name_en || !owner_id || !price) {
//       return res.status(400).json({
//         success: false,
//         message: "English name, owner_id, and price are required",
//       });
//     }

//     // Process image uploads if they exist
//     let uploadedImages = [];
//     let uploadedThumbnails = [];
//     const images = req.files || [];

//     if (images.length > 0) {
//       await authorize();
//       const uploadUrlResponse = await b2.getUploadUrl({
//         bucketId: process.env.B2_BUCKET_ID,
//       });

//       const { uploadUrl, authorizationToken } = uploadUrlResponse.data;

//       for (const file of images) {
//         const fileName = `products/${Date.now()}_${file.originalname}`;
//         const thumbnailName = `products/thumbnails/${Date.now()}_${
//           file.originalname
//         }`;

//         // Generate thumbnail
//         const thumbnailBuffer = await sharp(file.buffer)
//           .resize(400, 400)
//           .toBuffer();

//         // Upload original
//         await b2.uploadFile({
//           uploadUrl,
//           uploadAuthToken: authorizationToken,
//           fileName,
//           data: file.buffer,
//           contentType: file.mimetype,
//         });

//         // Upload thumbnail
//         await b2.uploadFile({
//           uploadUrl,
//           uploadAuthToken: authorizationToken,
//           fileName: thumbnailName,
//           data: thumbnailBuffer,
//           contentType: file.mimetype,
//         });

//         uploadedImages.push(
//           `${process.env.B2_BUCKET_URL}${process.env.B2_BUCKET_NAME}/${fileName}`
//         );
//         uploadedThumbnails.push(
//           `${process.env.B2_BUCKET_URL}${process.env.B2_BUCKET_NAME}/${thumbnailName}`
//         );
//       }
//     }

//     // Start transaction
//     const results = await runTransaction([
//       // Insert main product (language-independent data)
//       {
//         text: `
//           INSERT INTO products (brand, category, dimensions, attributes)
//           VALUES ($1, $2, $3, $4)
//           RETURNING id
//         `,
//         values: [
//           JSON.stringify(brand || {}),
//           JSON.stringify(category || {}),
//           JSON.stringify(dimensions || {}),
//           JSON.stringify(attributes || {}),
//         ],
//       },
//       // Insert English translation (required)
//       {
//         text: `
//           INSERT INTO product_translations 
//           (product_id, language_code, name, description)
//           VALUES ($1, 'en', $2, $3)
//         `,
//         values: ["placeholder", name_en, description_en],
//       },
//       // Insert French translation if provided
//       ...(name_fr
//         ? [
//             {
//               text: `
//           INSERT INTO product_translations 
//           (product_id, language_code, name, description)
//           VALUES ($1, 'fr', $2, $3)
//         `,
//               values: ["placeholder", name_fr, description_fr],
//             },
//           ]
//         : []),
//       // Insert user_product relationship
//       {
//         text: `
//           INSERT INTO user_products (
//             product_id, owner, owner_id, price, number_in_stock, 
//             discount, phone_number, status, address, city, colors
//           )
//           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
//           RETURNING *
//         `,
//         values: [
//           "placeholder",
//           owner,
//           owner_id,
//           parseFloat(price),
//           parseInt(number_in_stock) || 1,
//           parseFloat(discount) || 0,
//           phone_number,
//           status || "available",
//           address,
//           city,
//           colors ? colors.split(",") : [],
//         ],
//       },
//       // Insert images if any
//       ...(uploadedImages.length > 0
//         ? [
//             {
//               text: `
//           INSERT INTO product_images (product_id, image_path, thumbnail_path)
//           VALUES ${uploadedImages
//             .map((_, i) => `('placeholder', $${i * 2 + 1}, $${i * 2 + 2})`)
//             .join(",")}
//         `,
//               values: uploadedImages.flatMap((img, i) => [
//                 img,
//                 uploadedThumbnails[i],
//               ]),
//             },
//           ]
//         : []),
//     ]);

//     // Replace placeholder with actual product_id
//     const productId = results[0].rows[0].id;
//     results[1].values[0] = productId;
//     if (name_fr) results[2].values[0] = productId;
//     results[name_fr ? 3 : 2].values[0] = productId;
//     if (uploadedImages.length > 0) {
//       results[name_fr ? 4 : 3].values = results[name_fr ? 4 : 3].values.map(
//         (v) => (v === "placeholder" ? productId : v)
//       );
//     }

//     res.status(201).json({
//       success: true,
//       productId,
//       listing: results[name_fr ? 3 : 2].rows[0],
//       images: uploadedImages,
//     });
//   } catch (err) {
//     console.error("Error creating product:", err);
//     res.status(500).json({
//       success: false,
//       error: "Failed to create product",
//       details: process.env.NODE_ENV === "development" ? err.message : undefined,
//     });
//   }
// });

// // Update product
// router.put("/product/:id", upload.array("images"), async (req, res) => {
//   try {
//     const { id } = req.params;
//     const productData = JSON.parse(req.body.product);
//     const images = req.files || [];
//     const language = req.query.lang || "en"; // Default to English

//     // Check product exists
//     const productExists = await query("SELECT id FROM products WHERE id = $1", [
//       id,
//     ]);
//     if (productExists.rows.length === 0) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Product not found" });
//     }

//     // Process image uploads if any
//     let uploadedImages = [];
//     let uploadedThumbnails = [];

//     if (images.length > 0) {
//       await authorize();
//       const uploadUrlResponse = await b2.getUploadUrl({
//         bucketId: process.env.B2_BUCKET_ID,
//       });

//       const { uploadUrl, authorizationToken } = uploadUrlResponse.data;

//       for (const file of images) {
//         const fileName = `products/${Date.now()}_${file.originalname}`;
//         const thumbnailName = `products/thumbnails/${Date.now()}_${
//           file.originalname
//         }`;

//         // Generate thumbnail
//         const thumbnailBuffer = await sharp(file.buffer)
//           .resize(200, 200)
//           .toBuffer();

//         // Upload original
//         await b2.uploadFile({
//           uploadUrl,
//           uploadAuthToken: authorizationToken,
//           fileName,
//           data: file.buffer,
//           contentType: file.mimetype,
//         });

//         // Upload thumbnail
//         await b2.uploadFile({
//           uploadUrl,
//           uploadAuthToken: authorizationToken,
//           fileName: thumbnailName,
//           data: thumbnailBuffer,
//           contentType: file.mimetype,
//         });

//         uploadedImages.push(
//           `${process.env.B2_BUCKET_URL}${process.env.B2_BUCKET_NAME}/${fileName}`
//         );
//         uploadedThumbnails.push(
//           `${process.env.B2_BUCKET_URL}${process.env.B2_BUCKET_NAME}/${thumbnailName}`
//         );
//       }
//     }

//     // Prepare update queries
//     const queries = [
//       // Update product (language-independent data)
//       {
//         text: `
//           UPDATE products 
//           SET 
//             brand = COALESCE($1, brand),
//             category = COALESCE($2, category),
//             dimensions = COALESCE($3, dimensions),
//             attributes = COALESCE($4, attributes)
//           WHERE id = $5
//           RETURNING *
//         `,
//         values: [
//           productData.brand ? JSON.stringify(productData.brand) : undefined,
//           productData.category
//             ? JSON.stringify(productData.category)
//             : undefined,
//           productData.dimensions
//             ? JSON.stringify(productData.dimensions)
//             : undefined,
//           productData.attributes
//             ? JSON.stringify(productData.attributes)
//             : undefined,
//           id,
//         ],
//       },
//       // Update or insert English translation
//       {
//         text: `
//           INSERT INTO product_translations (product_id, language_code, name, description)
//           VALUES ($1, 'en', $2, $3)
//           ON CONFLICT (product_id, language_code) 
//           DO UPDATE SET 
//             name = COALESCE(EXCLUDED.name, product_translations.name),
//             description = COALESCE(EXCLUDED.description, product_translations.description)
//         `,
//         values: [id, productData.name_en, productData.description_en],
//       },
//     ];

//     // Add French translation update if provided
//     if (productData.name_fr) {
//       queries.push({
//         text: `
//           INSERT INTO product_translations (product_id, language_code, name, description)
//           VALUES ($1, 'fr', $2, $3)
//           ON CONFLICT (product_id, language_code) 
//           DO UPDATE SET 
//             name = COALESCE(EXCLUDED.name, product_translations.name),
//             description = COALESCE(EXCLUDED.description, product_translations.description)
//         `,
//         values: [id, productData.name_fr, productData.description_fr],
//       });
//     }

//     // Update user_product
//     queries.push({
//       text: `
//         UPDATE user_products
//         SET
//           price = COALESCE($1, price),
//           number_in_stock = COALESCE($2, number_in_stock),
//           discount = COALESCE($3, discount),
//           phone_number = COALESCE($4, phone_number),
//           status = COALESCE($5, status),
//           address = COALESCE($6, address),
//           city = COALESCE($7, city),
//           colors = COALESCE($8, colors),
//           owner = COALESCE($9, owner),
//           owner_id = COALESCE($10, owner_id)
//         WHERE product_id = $11
//         RETURNING *
//       `,
//       values: [
//         productData.price,
//         productData.number_in_stock,
//         productData.discount,
//         productData.phone_number,
//         productData.status,
//         productData.address,
//         productData.city,
//         productData.colors,
//         productData.owner,
//         productData.owner_id,
//         id,
//       ],
//     });

//     // If new images, delete old ones and insert new
//     if (uploadedImages.length > 0) {
//       queries.push(
//         {
//           text: "DELETE FROM product_images WHERE product_id = $1",
//           values: [id],
//         },
//         {
//           text: `
//             INSERT INTO product_images (product_id, image_path, thumbnail_path)
//             VALUES ${uploadedImages
//               .map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`)
//               .join(",")}
//           `,
//           values: [
//             id,
//             ...uploadedImages.flatMap((img, i) => [img, uploadedThumbnails[i]]),
//           ],
//         }
//       );
//     }

//     // Run transaction
//     const results = await runTransaction(queries);

//     // Get updated product with translations
//     const productRes = await query(
//       `
//       SELECT 
//         p.*,
//         (SELECT json_agg(t) FROM (
//           SELECT * FROM product_translations pt 
//           WHERE pt.product_id = p.id AND pt.language_code = $2
//         ) t) AS translations
//       FROM products p
//       WHERE p.id = $1
//     `,
//       [id, language]
//     );

//     res.json({
//       success: true,
//       product: {
//         ...productRes.rows[0],
//         current_translation: productRes.rows[0].translations?.[0] || null,
//       },
//       user_product: results[productData.name_fr ? 3 : 2].rows[0],
//       images: uploadedImages.length > 0 ? uploadedImages : undefined,
//     });
//   } catch (err) {
//     console.error("Error updating product:", err);
//     res.status(500).json({
//       success: false,
//       error: "Failed to update product",
//       details: err.message,
//     });
//   }
// });

router.put("/adminEdit/:id/:user_id", upload.array("images"), async (req, res) => {
  try {
    const { id, user_id } = req.params;
    const productData = JSON.parse(req.body.product);
    const images = req.files || [];
    const language = req.query.lang || "en";

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "Missing user_id parameter.",
      });
    }

    // Check if the product belongs to the user
    const ownershipCheck = await query(
      `SELECT * FROM user_products WHERE product_id = $1 AND owner_id = $2`,
      [id, user_id]
    );

    if (ownershipCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: You do not own this product.",
      });
    }

    // B2 image uploads (same as before)
    let uploadedImages = [];
    let uploadedThumbnails = [];

    if (images.length > 0) {
      await authorize();
      const uploadUrlResponse = await b2.getUploadUrl({
        bucketId: process.env.B2_BUCKET_ID,
      });

      const { uploadUrl, authorizationToken } = uploadUrlResponse.data;

      for (const file of images) {
        const timestamp = Date.now();
        const fileName = `products/${timestamp}_${file.originalname}`;
        const thumbnailName = `products/thumbnails/${timestamp}_${file.originalname}`;

        const thumbnailBuffer = await sharp(file.buffer)
          .resize(400, 400)
          .toBuffer();

        await b2.uploadFile({
          uploadUrl,
          uploadAuthToken: authorizationToken,
          fileName,
          data: file.buffer,
          contentType: file.mimetype,
        });

        await b2.uploadFile({
          uploadUrl,
          uploadAuthToken: authorizationToken,
          fileName: thumbnailName,
          data: thumbnailBuffer,
          contentType: file.mimetype,
        });

        uploadedImages.push(
          `${process.env.B2_BUCKET_URL}${process.env.B2_BUCKET_NAME}/${fileName}`
        );
        uploadedThumbnails.push(
          `${process.env.B2_BUCKET_URL}${process.env.B2_BUCKET_NAME}/${thumbnailName}`
        );
      }
    }

    // SQL update queries
    const queries = [
      {
        text: `
          UPDATE products 
          SET 
            brand = COALESCE($1, brand),
            category = COALESCE($2, category),
            dimensions = COALESCE($3, dimensions),
            attributes = COALESCE($4, attributes),
            thumbnail_index = COALESCE($5, thumbnail_index)
          WHERE id = $6
        `,
        values: [
          productData.brand ? JSON.stringify(productData.brand) : undefined,
          productData.category ? JSON.stringify(productData.category) : undefined,
          productData.dimensions ? JSON.stringify(productData.dimensions) : undefined,
          productData.attributes ? JSON.stringify(productData.attributes) : undefined,
          productData.thumbnail_index,
          id,
        ],
      },
      {
        text: `
          INSERT INTO product_translations (product_id, language_code, name, description)
          VALUES ($1, 'en', $2, $3)
          ON CONFLICT (product_id, language_code) 
          DO UPDATE SET 
            name = COALESCE(EXCLUDED.name, product_translations.name),
            description = COALESCE(EXCLUDED.description, product_translations.description)
        `,
        values: [id, productData.name_en, productData.description_en],
      },
    ];

    if (productData.name_fr) {
      queries.push({
        text: `
          INSERT INTO product_translations (product_id, language_code, name, description)
          VALUES ($1, 'fr', $2, $3)
          ON CONFLICT (product_id, language_code) 
          DO UPDATE SET 
            name = COALESCE(EXCLUDED.name, product_translations.name),
            description = COALESCE(EXCLUDED.description, product_translations.description)
        `,
        values: [id, productData.name_fr, productData.description_fr],
      });
    }

    queries.push({
      text: `
        UPDATE user_products
        SET
          price = COALESCE($1, price),
          number_in_stock = COALESCE($2, number_in_stock),
          discount = COALESCE($3, discount),
          phone_number = COALESCE($4, phone_number),
          status = COALESCE($5, status),
          address = COALESCE($6, address),
          city = COALESCE($7, city),
          colors = COALESCE($8, colors),
          owner = COALESCE($9, owner),
          owner_id = COALESCE($10,owner_id )
        WHERE product_id = $11 AND owner_id = $12
        RETURNING *
      `,
      values: [
        productData.price,
        productData.number_in_stock,
        productData.discount,
        productData.phone_number,
        productData.status,
        productData.address,
        productData.city,
        productData.colors,
        productData.owner,
        productData.owner_id,
        id,
        user_id,
      ],
    });

    if (uploadedImages.length > 0) {
      queries.push(
        {
          text: "DELETE FROM product_images WHERE product_id = $1",
          values: [id],
        },
        {
          text: `
            INSERT INTO product_images (product_id, image_path, thumbnail_path)
            VALUES ${uploadedImages
              .map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`)
              .join(",")}
          `,
          values: [
            id,
            ...uploadedImages.flatMap((img, i) => [img, uploadedThumbnails[i]]),
          ],
        }
      );
    }

    const results = await runTransaction(queries);

    const productRes = await query(
      `
      SELECT 
        p.*,
        (SELECT json_agg(t) FROM (
          SELECT * FROM product_translations pt 
          WHERE pt.product_id = p.id AND pt.language_code = $2
        ) t) AS translations
      FROM products p
      WHERE p.id = $1
    `,
      [id, language]
    );

    res.json({
      success: true,
      product: {
        ...productRes.rows[0],
        current_translation: productRes.rows[0].translations?.[0] || null,
      },
      user_product: results[productData.name_fr ? 3 : 2].rows[0],
      images: uploadedImages.length > 0 ? uploadedImages : undefined,
    });
  } catch (err) {
    console.error("Error updating product:", err);
    res.status(500).json({
      success: false,
      error: "Failed to update product",
      details: err.message,
    });
  }
});


// // PUT /user-product/:product_id/:owner_id
// router.put("/user-product/:product_id/:owner_id", async (req, res) => {
//   const { product_id, owner_id } = req.params;
//   const {
//     price,
//     number_in_stock,
//     discount,
//     phone_number,
//     status,
//     address,
//     city,
//     colors,
//   } = req.body;

//   try {
//     // Check ownership
//     const ownershipCheck = await query(
//       `SELECT * FROM user_products WHERE product_id = $1 AND owner_id = $2`,
//       [product_id, owner_id]
//     );

//     if (ownershipCheck.rows.length === 0) {
//       return res.status(403).json({
//         success: false,
//         message: "Unauthorized: You do not own this product.",
//       });
//     }

//     // Perform the update
//     const updateResult = await query(
//       `
//       UPDATE user_products
//       SET
//         price = COALESCE($1, price),
//         number_in_stock = COALESCE($2, number_in_stock),
//         discount = COALESCE($3, discount),
//         phone_number = COALESCE($4, phone_number),
//         status = COALESCE($5, status),
//         address = COALESCE($6, address),
//         city = COALESCE($7, city),
//         colors = COALESCE($8, colors)
//       WHERE product_id = $9 AND owner_id = $10
//       RETURNING *
//     `,
//       [
//         price,
//         number_in_stock,
//         discount,
//         phone_number,
//         status,
//         address,
//         city,
//         colors ? colors : null,
//         product_id,
//         owner_id,
//       ]
//     );

//     res.json({
//       success: true,
//       message: "User product updated successfully.",
//       data: updateResult.rows[0],
//     });
//   } catch (error) {
//     console.error("Error updating user product:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to update user product.",
//       error: error.message,
//     });
//   }
// });


// Delete a user's reference to a product, and delete the product completely if no other user is referencing it
router.delete("/delete/:productId/user/:userId", async (req, res) => {
  const { productId, userId } = req.params;

  try {
    // Step 1: Delete the user's reference to the product
    const deleteUserProduct = await query(
      "DELETE FROM user_products WHERE product_id = $1 AND owner_id = $2",
      [productId, userId]
    );

    if (deleteUserProduct.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "User-product link not found",
      });
    }

    // Step 2: Check if any other user is still referencing the product
    const checkOtherUsers = await query(
      "SELECT COUNT(*) FROM user_products WHERE product_id = $1",
      [productId]
    );

    const count = parseInt(checkOtherUsers.rows[0].count);

    // Step 3: If no one else references it, delete the product (cascades to translations, etc.)
    if (count === 0) {
      await query("DELETE FROM products WHERE id = $1", [productId]);
    }

    res.json({ success: true, message: "Product deleted successfully" });
  } catch (err) {
    console.error("Delete Error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// // Like a product
// router.post("/products/:id/like", async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { userId, username } = req.body;

//     if (!userId || !username) {
//       return res.status(400).json({
//         success: false,
//         message: "userId and username are required",
//       });
//     }

//     // Check if already liked
//     const existingLike = await query(
//       "SELECT id FROM product_likes WHERE product_id = $1 AND user_id = $2",
//       [id, userId]
//     );

//     if (existingLike.rows.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: "User already liked this product",
//       });
//     }

//     await runTransaction([
//       {
//         text: "UPDATE products SET likes = likes + 1 WHERE id = $1",
//         values: [id],
//       },
//       {
//         text: `
//           INSERT INTO product_likes (product_id, user_id, username)
//           VALUES ($1, $2, $3)
//         `,
//         values: [id, userId, username],
//       },
//     ]);

//     const { rows } = await query("SELECT likes FROM products WHERE id = $1", [
//       id,
//     ]);

//     res.json({
//       success: true,
//       likes: rows[0].likes,
//       message: "Product liked successfully",
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false, error: "Server error" });
//   }
// });

// // Unlike a product
// router.delete("/products/:id/like", async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { userId } = req.body;

//     if (!userId) {
//       return res.status(400).json({
//         success: false,
//         message: "userId is required",
//       });
//     }

//     // Check if like exists
//     const existingLike = await query(
//       "SELECT id FROM product_likes WHERE product_id = $1 AND user_id = $2",
//       [id, userId]
//     );

//     if (existingLike.rows.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: "User hasn't liked this product",
//       });
//     }

//     await runTransaction([
//       {
//         text: "UPDATE products SET likes = GREATEST(likes - 1, 0) WHERE id = $1",
//         values: [id],
//       },
//       {
//         text: "DELETE FROM product_likes WHERE product_id = $1 AND user_id = $2",
//         values: [id, userId],
//       },
//     ]);

//     const { rows } = await query("SELECT likes FROM products WHERE id = $1", [
//       id,
//     ]);

//     res.json({
//       success: true,
//       likes: rows[0].likes,
//       message: "Product unliked successfully",
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false, error: "Server error" });
//   }
// });

// // Search products with translations
router.get("/categories", async (req, res) => {
  try {
    const queryParam = req.query.query;
const searchQuery = decodeURIComponent(queryParam || "").trim();

// Now searchTerm = "Savana"

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 100);
    const di1 = req.query.di1 && req.query.di1 !== "undefined" ? req.query.di1 : null;
    const di2 = req.query.di2 && req.query.di2 !== "undefined" ? req.query.di2 : null;
    const di3 = req.query.di3 && req.query.di3 !== "undefined" ? req.query.di3 : null;

    const language = req.query.lang || 'en';

    const offset = (page - 1) * limit;

    let filterConstraints = "";
    let params = [language, searchQuery, limit, offset];

    if (di1 && di2 && di3) {
      filterConstraints = `p.${di1}->>'${di2}' ILIKE '%' || $2 || '%'`;
      params.push(di3);
    } else if (di1 && di2) {
      filterConstraints = `p.${di1}->>'${di2}' ILIKE '%' || $2 || '%'`;

    } else {

      filterConstraints = `
    (
    

           pt.name ILIKE '%' || $2 || '%' OR
          pt.description ILIKE '%' || $2 || '%' OR
          p.brand->>'name' ILIKE '%' || $2 || '%' OR
          p.category->>'main' ILIKE '%' || $2 || '%' OR
          up.owner ILIKE '%' || $2 || '%' OR
          up.city ILIKE '%' || $2 || '%' OR
          up.address ILIKE '%' || $2 || '%' OR
          p.category->>'sub' ILIKE '%' || $2 || '%'
    )
  `;
      if (di3) params.push(di3);
    }


    const ownerFilter = di3 ? `AND up.owner_id = $${params.length}` : '';

    const queryText = `
      SELECT 
        p.id,
        p.brand,
        p.category,
        p.dimensions,
        p.attributes,
        p.thumbnail_index,
        p.created_at,
        pt.name,
        pt.description,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'id', up.id,
            'product_id',up.product_id,
            'price', up.price,
            'discount', up.discount,
            'status', up.status,
            'colors', up.colors,
            'owner', up.owner,
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
        ) AS images,
        COUNT(*) OVER() AS total_count
      FROM products p
      JOIN product_translations pt ON p.id = pt.product_id
      JOIN user_products up ON p.id = up.product_id
      WHERE pt.language_code = $1
        AND (${filterConstraints})
        ${ownerFilter}
      ORDER BY p.created_at DESC
      LIMIT $3 OFFSET $4
    `;

    const { rows } = await query(queryText, params);

    const totalResults = rows[0]?.total_count || 0;
    const fallbackImage = "https://yourcdn.com/default.jpg";

    res.json({
      success: true,
      query: searchQuery,
      page,
      limit,
      totalPages: Math.ceil(totalResults / limit),
      totalResults,
      results: rows.map(({ images, total_count, ...product }) => {
        const imageList = Array.isArray(images) ? images : [];
        const imagePaths = imageList.map(img => img.image_path).filter(Boolean);
        const thumbnailPaths = imageList.map(img => img.thumbnail_path).filter(Boolean);

        return {
          ...product,
          images: imagePaths.length ? imagePaths : [fallbackImage],
          thumbnails: thumbnailPaths.length ? thumbnailPaths : [fallbackImage],
          primaryImage: imagePaths[0] || fallbackImage,
          thumbnail: thumbnailPaths[0] || fallbackImage,
        };
      }),
    });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({
      success: false,
      error: "Search failed",
      ...(process.env.NODE_ENV === "development" && { details: err.message }),
    });
  }
});



router.get("/search", async (req, res) => {
  try {
    const searchQuery = req.query.query?.trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 100);
    const offset = (page - 1) * limit;
    const language = req.query.lang || 'en';


    const { rows } = await query(`
      SELECT 
        p.id,
        p.brand,
        p.category,
        p.dimensions,
        p.attributes,
        p.thumbnail_index,
        p.created_at,
        pt.name,
        pt.description,

        (
          SELECT jsonb_agg(jsonb_build_object(
            'id', up.id,
            'price', up.price,
            'product_id',up.product_id,
            'discount', up.discount,
            'status', up.status,
            'colors', up.colors,
            'owner', up.owner,
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
        ) AS images,

        COUNT(*) OVER() AS total_count

      FROM products p
      JOIN product_translations pt ON p.id = pt.product_id
      JOIN user_products up ON p.id = up.product_id
      WHERE pt.language_code = $1
        AND (
          pt.name ILIKE '%' || $2 || '%' OR
          pt.description ILIKE '%' || $2 || '%' OR
          p.brand->>'name' ILIKE '%' || $2 || '%' OR
          p.category->>'main' ILIKE '%' || $2 || '%' OR
          up.owner ILIKE '%' || $2 || '%' OR
          up.city ILIKE '%' || $2 || '%' OR
          up.address ILIKE '%' || $2 || '%' OR
          p.category->>'sub' ILIKE '%' || $2 || '%'
        )
      ORDER BY p.created_at DESC
      LIMIT $3 OFFSET $4
    `, [language, searchQuery, limit, offset]);

    const totalResults = rows[0]?.total_count || 0;

    res.json({
      success: true,
      query: searchQuery,
      page,
      limit,
      totalPages: Math.ceil(totalResults / limit),
      totalResults,
      results: rows.map(({ images, total_count, ...product }) => {
        const imageList = Array.isArray(images) ? images : [];

        const imagePaths = imageList
          .map((img) => img.image_path)
          .filter(Boolean);

        const thumbnailPaths = imageList
          .map((img) => img.thumbnail_path)
          .filter(Boolean);

        return {
          ...product,
          images: imagePaths.length ? imagePaths : [fallbackImage],
          thumbnails: thumbnailPaths.length ? thumbnailPaths : [fallbackImage],
          primaryImage: imagePaths[0] || fallbackImage,
          thumbnail: thumbnailPaths[0] || fallbackImage
        };
      })
    });

  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({
      success: false,
      error: "Search failed",
      ...(process.env.NODE_ENV === "development" && { details: err.message }),
    });
  }
});


router.get("/ownerSearch", async (req, res) => {
  try {
       const queryParam = req.query.query;
const searchQuery = decodeURIComponent(queryParam || "").trim();
    
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 100);
    const offset = (page - 1) * limit;
    const language = req.query.lang || 'en';
    const ownerId = req.query.owner_id; // <-- Add owner_id filter

    if (!searchQuery || searchQuery.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Search query must be at least 2 characters"
      });
    }

    // Build dynamic SQL for owner_id filter
    let ownerFilter = '';
    let params = [language, searchQuery, limit, offset];
    if (ownerId) {
      ownerFilter = 'AND up.owner_id = $5';
      params.push(ownerId);
    }

    const { rows } = await query(`
      SELECT 
        p.id,
        p.brand,
        p.category,
        p.dimensions,
        p.attributes,
        p.thumbnail_index,
        p.created_at,
        pt.name,
        pt.description,

        (
          SELECT jsonb_agg(jsonb_build_object(
            'id', up2.id,
            'product_id',up2.product_id,
            'price', up2.price,
            'discount', up2.discount,
            'status', up2.status,
            'colors', up2.colors,
            'owner', up2.owner,
            'number_in_stock', up2.number_in_stock,
            'phone_number', up2.phone_number,
            'address', up2.address,
            'city', up2.city
          ))
          FROM user_products up2
          WHERE up2.product_id = p.id
        ) AS user_products,

        (
          SELECT jsonb_agg(jsonb_build_object(
            'image_path', pi.image_path,
            'thumbnail_path', pi.thumbnail_path
          ))
          FROM product_images pi
          WHERE pi.product_id = p.id
        ) AS images,

        COUNT(*) OVER() AS total_count

      FROM products p
      JOIN product_translations pt ON p.id = pt.product_id
      JOIN user_products up ON p.id = up.product_id
      WHERE pt.language_code = $1
        AND (
          pt.name ILIKE '%' || $2 || '%' OR
          pt.description ILIKE '%' || $2 || '%' OR
          p.brand->>'name' ILIKE '%' || $2 || '%' OR
          p.category->>'main' ILIKE '%' || $2 || '%' OR
          up.owner ILIKE '%' || $2 || '%' OR
          p.category->>'sub' ILIKE '%' || $2 || '%'
        )
        ${ownerFilter}
      ORDER BY p.created_at DESC
      LIMIT $3 OFFSET $4
    `, params);

    const totalResults = rows[0]?.total_count || 0;

    res.json({
      success: true,
      query: searchQuery,
      page,
      limit,
      totalPages: Math.ceil(totalResults / limit),
      totalResults,
      results: rows.map(({ images, total_count, ...product }) => {
        const imageList = Array.isArray(images) ? images : [];

        const imagePaths = imageList
          .map((img) => img.image_path)
          .filter(Boolean);

        const thumbnailPaths = imageList
          .map((img) => img.thumbnail_path)
          .filter(Boolean);

        return {
          ...product,
          images: imagePaths.length ? imagePaths : [fallbackImage],
          thumbnails: thumbnailPaths.length ? thumbnailPaths : [fallbackImage],
          primaryImage: imagePaths[0] || fallbackImage,
          thumbnail: thumbnailPaths[0] || fallbackImage
        };
      })
    });

  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({
      success: false,
      error: "Search failed",
      ...(process.env.NODE_ENV === "development" && { details: err.message }),
    });
  }
});
module.exports = router;

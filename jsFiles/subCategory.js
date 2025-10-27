const express = require("express");
const { query } = require("./db"); // Your PostgreSQL connection
const jwt = require("jsonwebtoken"); // Ensure you have this package installed
const router = express.Router();

// Middleware to authenticate token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: "Token not provided" });
  }

  jwt.verify(token, process.env.JWT_SECRET
    , (err, user) => {
    if (err) {
      console.error("Token verification failed:", err);
      return res.status(403).json({ error: "Invalid token" });
    }
    req.user = user;
    next();
  });
}

router.get("/subCategory", async (req, res) => {
  try {
    const language = req.query.lang || "en";
    const fallbackImage = "https://example.com/fallback.jpg"; // define your fallback image

    // ✅ Main query: group products by category_main and limit to 20 products each
    const groupedQuery = `
      WITH ranked_products AS (
        SELECT 
          p.id,
          p.brand,
          p.category_main,
          p.category_sub,
          p.dimensions,
          p.attributes,
          p.created_at,
          pt.name,
          pt.description,
          ROW_NUMBER() OVER (PARTITION BY p.category_sub ORDER BY p.created_at DESC) AS rn
        FROM products p
        JOIN product_translations pt 
          ON p.id = pt.product_id AND pt.language_code = $1
      )
      SELECT 
        rp.category_sub,
        jsonb_agg(
          jsonb_build_object(
            'id', rp.id,
            'brand', rp.brand,
            'category_sub', rp.category_sub,
            'category_main', rp.category_main,
            'dimensions', rp.dimensions,
            'attributes', rp.attributes,
            'created_at', rp.created_at,
            'name', rp.name,
            'description', rp.description,
            'user_products', (
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
              WHERE up.product_id = rp.id
            ),
            'images', (
              SELECT jsonb_agg(jsonb_build_object(
                'image_path', pi.image_path,
                'thumbnail_path', pi.thumbnail_path
              ))
              FROM product_images pi
              WHERE pi.product_id = rp.id
            )
          )
        ) AS products
      FROM ranked_products rp
      WHERE rp.rn <= 10
      GROUP BY rp.category_sub
      ORDER BY rp.category_sub ASC;
    `;

    const { rows } = await query(groupedQuery, [language]);

    // ✅ Format and clean image data
    const categories = rows.map((category) => ({
      category_sub: category.category_sub,
      products: (category.products || []).map((product) => {
        const imagesData = product.images || [];
        const images = imagesData.map((i) => i.image_path).filter(Boolean);
        const thumbnails = imagesData.map((i) => i.thumbnail_path).filter(Boolean);

        return {
          ...product,
          images: images.length ? images : [fallbackImage],
          thumbnails: thumbnails.length ? thumbnails : [fallbackImage],
          primaryImage: images[0] || fallbackImage,
          thumbnail: thumbnails[0] || fallbackImage,
        };
      }),
    }));

    res.json({
      success: true,
      totalCategories: categories.length,
      categories,
    });

  } catch (err) {
    console.error("Error fetching products by category:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch products by category",
      ...(process.env.NODE_ENV === "development" && { details: err.message }),
    });
  }
});




module.exports = router;

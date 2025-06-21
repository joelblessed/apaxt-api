
const fs = require('fs');
const dayjs = require('dayjs');
const {query} = require("./jsFiles/db"); // PostgreSQL connection


const SITE_URL = 'https://apaxt.com';

async function generateSitemap() {
  try {
  

    // Fetch products (adjust based on your schema)
    
 const res = await query(
  `SELECT 
      p.id,
      p.brand,
      p.category,
      p.dimensions,
      p.attributes,
      p.created_at,
      p.updated_at, -- add this
      p.thumbnail_index,
      pt.name,
      pt.description,
      json_agg(DISTINCT up.*) FILTER (WHERE up.id IS NOT NULL) AS user_products,
      json_agg(DISTINCT jsonb_build_object(
        'image_path', pi.image_path,
        'thumbnail_path', pi.thumbnail_path
      )) FILTER (WHERE pi.image_path IS NOT NULL) AS images
    FROM products p
    JOIN product_translations pt 
      ON p.id = pt.product_id AND pt.language_code = $1
    LEFT JOIN user_products up 
      ON p.id = up.product_id
    LEFT JOIN product_images pi 
      ON p.id = pi.product_id
    GROUP BY p.id, pt.name, pt.description, p.updated_at
    ORDER BY p.created_at DESC
  `, ['en'] // <-- add language param
);

    const products = res.rows;



    
    // Generate XML
   
let sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n`;
sitemap += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n`;
sitemap += `        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n`;

products.forEach((product) => {
  const slug = (product.name || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');

  const url = `${SITE_URL}/product/${product.id}-${slug}`;
  const lastmod = dayjs(product.updated_at || product.created_at || new Date()).format('YYYY-MM-DD');

  sitemap += `  <url>\n`;
  sitemap += `    <loc>${url}</loc>\n`;
  sitemap += `    <lastmod>${lastmod}</lastmod>\n`;
  sitemap += `    <priority>0.85</priority>\n`;

  // Add images if available
  const images = Array.isArray(product.images) ? product.images : [];
  images.forEach(img => {
    if (img && img.image_path) {
      sitemap += `    <image:image>\n`;
      sitemap += `      <image:loc>${img.image_path}</image:loc>\n`;
      sitemap += `    </image:image>\n`;
    }
  });

  sitemap += `  </url>\n`;
});

sitemap += `</urlset>`;


    // Save sitemap.xml
    fs.writeFileSync('public/sitemap.xml', sitemap, 'utf8');
    console.log('✅ Sitemap generated successfully!');
  } catch (err) {
    console.error('❌ Error generating sitemap:', err);
  } finally {
  
  }
}

generateSitemap();
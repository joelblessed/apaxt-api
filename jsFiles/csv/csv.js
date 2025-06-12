const fs = require("fs");
const csv = require("csv-parser");
const { query } = require("../db"); // your pg query function

fs.createReadStream("product_bulk_import.csv")
  .pipe(csv({ separator: ',' }))
  .on("data", async (row) => {
    try {
      // 1. Insert into products
      const productInsert = await query(`
        INSERT INTO products (brand, category, dimensions, attributes)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [
        JSON.parse(row.brand),
        JSON.parse(row.category),
        JSON.parse(row.dimensions),
        JSON.parse(row.attributes)
      ]);
      const productId = productInsert.rows[0].id;

      // 2. Insert into product_translations (English & French)
      await query(`
        INSERT INTO product_translations (product_id, language_code, name, description)
        VALUES ($1, 'en', $2, $3), ($1, 'fr', $4, $5)
      `, [
        productId,
        row.name_en,
        row.desc_en,
        row.name_fr,
        row.desc_fr
      ]);

      // 3. Insert into user_products
      await query(`
        INSERT INTO user_products (
          product_id, owner, owner_id, price, number_in_stock, discount,
          phone_number, status, address, city, colors
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        productId,
        row.owner,
        row.owner_id,
        row.price,
        row.number_in_stock,
        row.discount || 0,
        row.phone_number,
        row.status || 'available',
        row.address,
        row.city,
        row.colors.replace(/[{}]/g, '').split(',') // convert to array
      ]);

      console.log(`Inserted product ID ${productId}`);
    } catch (err) {
      console.error("Error inserting row:", err.message);
    }
  })
  .on("end", () => {
    console.log("CSV import finished.");
  });
const { query } = require('./db'); // Import the PostgreSQL connection


-- Products table
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  price DECIMAL(10,2) CHECK (price > 0),
  description TEXT,
  category VARCHAR(50),
  brand VARCHAR(50),
  owner_id INTEGER REFERENCES users(id),
  likes INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Product likes tracking
CREATE TABLE product_likes (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  username VARCHAR(100) NOT NULL,
  liked_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (product_id, user_id)
);

-- Create indexes for performance
CREATE INDEX idx_products_search ON products USING GIN(to_tsvector('english', name || ' ' || category || ' ' || brand));
CREATE INDEX idx_product_likes ON product_likes(product_id, user_id);

// Get all products (with pagination)
router.get('/products', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  try {
    const { rows } = await query(
      'SELECT * FROM products ORDER BY id LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    res.json({ products: rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Get single product by ID
router.get('/products/:id', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM products WHERE id = $1', [
      req.params.id,
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Update product
router.put('/updateProduct/:id', upload.array('images'), async (req, res) => {
  const { name, price, description } = JSON.parse(req.body.product);
  
  try {
    const { rows } = await query(
      `UPDATE products 
       SET name = $1, price = $2, description = $3 
       WHERE id = $4 
       RETURNING *`,
      [name, price, description, req.params.id]
    );
    
    // Handle image updates if needed
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Delete product
router.delete('/deleteProduct/:id', async (req, res) => {
  try {
    await query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Like a product
router.patch('/products/:id/like', async (req, res) => {
    const { userId, username } = req.body;
  
    try {
      // Check if user already liked
      const checkLike = await query(
        'SELECT 1 FROM product_likes WHERE product_id = $1 AND user_id = $2',
        [req.params.id, userId]
      );
  
      if (checkLike.rows.length > 0) {
        return res.status(400).json({ message: 'Already liked' });
      }
  
      // Transaction for data consistency
      await query('BEGIN');
      
      // Update likes count
      await query(
        'UPDATE products SET likes = likes + 1 WHERE id = $1',
        [req.params.id]
      );
      
      // Record the like
      await query(
        'INSERT INTO product_likes (product_id, user_id, username) VALUES ($1, $2, $3)',
        [req.params.id, userId, username]
      );
      
      await query('COMMIT');
      
      // Get updated like count
      const { rows } = await query(
        'SELECT likes FROM products WHERE id = $1',
        [req.params.id]
      );
      
      res.json({ 
        message: 'Liked', 
        likes: rows[0].likes 
      });
    } catch (err) {
      await query('ROLLBACK');
      console.error(err);
      res.status(500).send('Server error');
    }
  });
  
  // Dislike a product
  router.patch('/products/:id/dislike', async (req, res) => {
    const { userId } = req.body;
  
    try {
      // Check if user actually liked
      const checkLike = await query(
        'SELECT 1 FROM product_likes WHERE product_id = $1 AND user_id = $2',
        [req.params.id, userId]
      );
  
      if (checkLike.rows.length === 0) {
        return res.status(400).json({ message: 'Not previously liked' });
      }
  
      await query('BEGIN');
      
      // Update likes count
      await query(
        'UPDATE products SET likes = likes - 1 WHERE id = $1',
        [req.params.id]
      );
      
      // Remove the like record
      await query(
        'DELETE FROM product_likes WHERE product_id = $1 AND user_id = $2',
        [req.params.id, userId]
      );
      
      await query('COMMIT');
      
      // Get updated like count
      const { rows } = await query(
        'SELECT likes FROM products WHERE id = $1',
        [req.params.id]
      );
      
      res.json({ 
        message: 'Disliked', 
        likes: rows[0].likes 
      });
    } catch (err) {
      await query('ROLLBACK');
      console.error(err);
      res.status(500).send('Server error');
    }
  });

//   search products

  router.get('/search', async (req, res) => {
    const query = req.query.query?.toLowerCase().trim();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
  
    if (!query) return res.json([]);
  
    try {
      // Full-text search with pagination
      const { rows } = await query(
        `SELECT * FROM products 
         WHERE to_tsvector('english', name || ' ' || category || ' ' || brand) 
         @@ to_tsquery('english', $1)
         ORDER BY id
         LIMIT $2 OFFSET $3`,
        [query.split(' ').join(' | '), limit, offset]
      );
  
      // Get total count for pagination
      const countResult = await query(
        `SELECT COUNT(*) FROM products 
         WHERE to_tsvector('english', name || ' ' || category || ' ' || brand) 
         @@ to_tsquery('english', $1)`,
        [query.split(' ').join(' | ')]
      );
  
      res.json({
        page,
        limit,
        totalResults: parseInt(countResult.rows[0].count),
        results: rows,
      });
    } catch (err) {
      console.error(err);
      res.status(500).send('Server error');
    }
  });
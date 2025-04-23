const { query } = require('./'); // Import the PostgreSQL connection

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
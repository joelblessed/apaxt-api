const express = require("express");
const jwt = require("jsonwebtoken");
const router = express.Router();
const { query } = require("./db"); // Your PostgreSQL connection
require("dotenv").config();

const JWT_SECRET = process.env.JWT_SECRET;

// Middleware: Verify Token
const verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (error) {
        res.status(401).json({ message: "Invalid token" });
    }
};

// Helper function to get or create user cart
const getOrCreateCart = async (userId) => {
    // Check if cart exists
    const cartResult = await query(
        'SELECT id FROM carts WHERE user_id = $1',
        [userId]
    );
    
    if (cartResult.rows.length === 0) {
        // Create new cart if doesn't exist
        const newCart = await query(
            'INSERT INTO carts (user_id) VALUES ($1) RETURNING id',
            [userId]
        );
        return newCart.rows[0].id;
    }
    return cartResult.rows[0].id;
};

// 1. Get User Cart
router.get("/cart", verifyToken, async (req, res) => {
    try {
        const cartId = await getOrCreateCart(req.userId);
        
        const cartItems = await query(
            `SELECT ci.id, p.id as product_id, p.name, p.price, ci.quantity 
             FROM cart_items ci
             JOIN products p ON ci.product_id = p.id
             WHERE ci.cart_id = $1`,
            [cartId]
        );
        
        res.json({ cart: cartItems.rows });
    } catch (error) {
        console.error("Error fetching cart:", error);
        res.status(500).json({ message: "Failed to fetch cart" });
    }
});

// 2. Add to Cart
router.post("/cart", verifyToken, async (req, res) => {
    try {
        const { productId, quantity } = req.body; // Ensure quantity is handled
        if (!productId) {
            return res.status(400).json({ message: "Product ID is required" });
        }

        const cartId = await getOrCreateCart(req.userId);

        const existingItem = await query(
            'SELECT id, quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2',
            [cartId, productId]
        );

        if (existingItem.rows.length > 0) {
            await query(
                'UPDATE cart_items SET quantity = quantity + $1 WHERE id = $2',
                [quantity, existingItem.rows[0].id]
            );
        } else {
            await query(
                'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)',
                [cartId, productId, quantity]
            );
        }

        const updatedCart = await query(
            `SELECT ci.id, p.id as product_id, p.name, p.price, ci.quantity 
             FROM cart_items ci
             JOIN products p ON ci.product_id = p.id
             WHERE ci.cart_id = $1`,
            [cartId]
        );

        res.json({ message: "Product added to cart", cart: updatedCart.rows });
    } catch (error) {
        console.error("Error adding to cart:", error);
        res.status(500).json({ message: "Failed to add to cart" });
    }
});

// 3. Update Product Quantity in Cart
router.put('/cart/:productId/:action', verifyToken, async (req, res) => {
    try {
        const { productId, action } = req.params;
        const cartId = await getOrCreateCart(req.userId);

        const itemResult = await query(
            'SELECT id, quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2',
            [cartId, productId]
        );

        if (itemResult.rows.length === 0) {
            return res.status(404).json({ message: "Product not found in cart" });
        }

        if (action === 'increment') {
            await query(
                'UPDATE cart_items SET quantity = quantity + 1 WHERE id = $1',
                [itemResult.rows[0].id]
            );
        } else if (action === 'decrement') {
            if (itemResult.rows[0].quantity > 1) {
                await query(
                    'UPDATE cart_items SET quantity = quantity - 1 WHERE id = $1',
                    [itemResult.rows[0].id]
                );
            } else {
                await query(
                    'DELETE FROM cart_items WHERE id = $1',
                    [itemResult.rows[0].id]
                );
            }
        } else {
            return res.status(400).json({ message: "Invalid action" });
        }

        const updatedCart = await query(
            `SELECT ci.id, p.id as product_id, p.name, p.price, ci.quantity 
             FROM cart_items ci
             JOIN products p ON ci.product_id = p.id
             WHERE ci.cart_id = $1`,
            [cartId]
        );

        res.json({ cart: updatedCart.rows });
    } catch (error) {
        console.error("Error updating cart:", error);
        res.status(500).json({ message: "Failed to update cart" });
    }
});

// 4. Remove from Cart
router.delete("/cart/:productId", verifyToken, async (req, res) => {
    try {
        const { productId } = req.params;
        const cartId = await getOrCreateCart(req.userId);

        const result = await query(
            'DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2 RETURNING id',
            [cartId, productId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: "Product not found in cart" });
        }

        // Get updated cart
        const updatedCart = await query(
            `SELECT ci.id, p.id as product_id, p.name, p.price, ci.quantity 
             FROM cart_items ci
             JOIN products p ON ci.product_id = p.id
             WHERE ci.cart_id = $1`,
            [cartId]
        );

        res.json({ 
            message: "Product removed from cart", 
            cart: updatedCart.rows 
        });
    } catch (error) {
        console.error("Error removing from cart:", error);
        res.status(500).json({ message: "Failed to remove from cart" });
    }
});

// 5. Merge Carts
router.post("/cart/merge", verifyToken, async (req, res) => {
    try {
        const { localCart } = req.body;
        if (!Array.isArray(localCart)) {
            return res.status(400).json({ message: "Invalid cart data" });
        }

        const cartId = await getOrCreateCart(req.userId);

        await query('BEGIN');

        for (const item of localCart) {
            if (!item.product_id || !item.quantity || item.quantity < 1) continue;

            const productExists = await query(
                'SELECT 1 FROM products WHERE id = $1',
                [item.product_id]
            );

            if (productExists.rows.length === 0) continue;

            const existingItem = await query(
                'SELECT id, quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2',
                [cartId, item.product_id]
            );

            if (existingItem.rows.length > 0) {
                await query(
                    'UPDATE cart_items SET quantity = quantity + $1 WHERE id = $2',
                    [item.quantity, existingItem.rows[0].id]
                );
            } else {
                await query(
                    'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)',
                    [cartId, item.product_id, item.quantity]
                );
            }
        }

        await query('COMMIT');

        const mergedCart = await query(
            `SELECT ci.id, p.id as product_id, p.name, p.price, ci.quantity 
             FROM cart_items ci
             JOIN products p ON ci.product_id = p.id
             WHERE ci.cart_id = $1`,
            [cartId]
        );

        res.json({ message: "Cart merged successfully", cart: mergedCart.rows });
    } catch (error) {
        await query('ROLLBACK');
        console.error("Error merging carts:", error);
        res.status(500).json({ message: "Failed to merge carts" });
    }
});

// 6. Clear Cart
router.delete("/cart", verifyToken, async (req, res) => {
    try {
        const cartId = await getOrCreateCart(req.userId);
        await query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
        res.json({ message: "Cart cleared successfully" });
    } catch (error) {
        console.error("Error clearing cart:", error);
        res.status(500).json({ message: "Failed to clear cart" });
    }
});

module.exports = router;
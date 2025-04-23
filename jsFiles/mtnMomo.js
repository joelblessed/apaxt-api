const express = require('express');
const axios = require('axios');
const { query } = require('../db'); // PostgreSQL connection
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
require('dotenv').config();

// MoMo API configuration
const momoHost = process.env.MOMO_ENV === 'production' 
    ? 'momodeveloper.mtn.com' 
    : 'sandbox.momodeveloper.mtn.com';
const momoTokenUrl = `https://${momoHost}/collection/token/`;
const momoRequestToPayUrl =` https://${momoHost}/collection/v1_0/requesttopay`;
const MOMO_SUBSCRIPTION_KEY = process.env.MOMO_SUBSCRIPTION_KEY;

// Create API User
router.post('/create-api-user', async (req, res) => {
    const uuid = uuidv4();
    const callbackHost = process.env.MOMO_CALLBACK_HOST || 'https://your-callback-url.com';

    try {
        // Store user in database first
        await query(
            'INSERT INTO momo_api_users (user_id, callback_host) VALUES ($1, $2)',
            [uuid, callbackHost]
        );

        // Create user in MoMo system
        const response = await axios.post(
            `https://${momoHost}/v1_0/apiuser`,
            { providerCallbackHost: callbackHost },
            {
                headers: {
                    'X-Reference-Id': uuid,
                    'Ocp-Apim-Subscription-Key': MOMO_SUBSCRIPTION_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );

        res.status(200).json({ 
            message: 'API user created successfully',
            userId: uuid 
        });
    } catch (error) {
        console.error('Error creating API user:', error);
        res.status(500).json({ 
            message: 'Error creating API user', 
            error: error.response?.data || error.message 
        });
    }
});

// Retrieve API Key
router.post('/retrieve-api-key/:userId', async (req, res) => {
    const userId = req.params.userId;

    try {
        // Retrieve API key from MoMo
        const response = await axios.post(
            `https://${momoHost}/v1_0/apiuser/${userId}/apikey`,
            {},
            { headers: { 'Ocp-Apim-Subscription-Key': MOMO_SUBSCRIPTION_KEY } }
        );

        const apiKey = response.data.apiKey;

        // Store API key in database
        await query(
            'UPDATE momo_api_users SET api_key = $1 WHERE user_id = $2',
            [apiKey, userId]
        );

        res.status(200).json({ apiKey });
    } catch (error) {
        console.error('Error retrieving API key:', error);
        res.status(500).json({ 
            message: 'Error retrieving API key',
            error: error.response?.data || error.message
        });
    }
});

// Generate API Token
router.post('/generate-api-token', async (req, res) => {
    const { userId } = req.body;

    try {
        // Get user API key from database
        const userResult = await query(
            'SELECT api_key FROM momo_api_users WHERE user_id = $1',
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const apiKey = userResult.rows[0].api_key;
        const basicAuth = 'Basic ' + Buffer.from(`${userId}:${apiKey}`).toString('base64');

        // Generate token from MoMo
        const response = await axios.post(
            momoTokenUrl,
            {},
            {
                headers: {
                    'Authorization': basicAuth,
                    'Ocp-Apim-Subscription-Key': MOMO_SUBSCRIPTION_KEY
                }
            }
        );

        const token = response.data.access_token;
        const expiresIn = response.data.expires_in;

        // Store token in database
        await query(
            'INSERT INTO momo_tokens (token, user_id, expires_at) VALUES ($1, $2, NOW() + $3 * INTERVAL \'1 second\')',
            [token, userId, expiresIn]
        );

        res.status(200).json({ 
            token,
            expiresIn
        });
    } catch (error) {
        console.error('Error generating API token:', error);
        res.status(500).json({ 
            message: 'Error generating API token',
            error: error.response?.data || error.message
        });
    }
});

// Request to Pay
router.post('/request-to-pay', async (req, res) => {
    const { amount, phone, momoTokenId } = req.body;

    try {
        // Validate token
        const tokenResult = await query(
            'SELECT * FROM momo_tokens WHERE token = $1 AND expires_at > NOW()',
            [momoTokenId]
        );

        if (tokenResult.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        const externalId = uuidv4();
        const paymentRefId = uuidv4();
        const currency = 'EUR'; // Adjust based on your requirements

        // Create transaction record
        await query(
            `INSERT INTO momo_transactions 
             (transaction_id, external_id, amount, currency, payer_msisdn, momo_token_id, payment_ref_id, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')`,
            [paymentRefId, externalId, amount, currency, phone, momoTokenId, paymentRefId]
        );

        // Make payment request to MoMo
        const response = await axios.post(
            momoRequestToPayUrl,
            {
                amount: amount,
                currency: currency,
                externalId: externalId,
                payer: {
                    partyIdType: 'MSISDN',
                    partyId: phone
                },
                payerMessage: 'Payment for goods/services',
                payeeNote: 'Thank you for your payment'
            },
            {
                headers: {
                    'X-Reference-Id': paymentRefId,
                    'X-Target-Environment': process.env.MOMO_ENV || 'sandbox',
                    'Ocp-Apim-Subscription-Key': MOMO_SUBSCRIPTION_KEY,
                    'Authorization': `Bearer ${momoTokenId}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        res.status(200).json({
            message: 'Payment request initiated',
            transactionId: paymentRefId,
            externalId: externalId
        });
    } catch (error) {
        console.error('Error in payment request:', error);
        
        // Update transaction status if record exists
        if (paymentRefId) {
            await query(
                'UPDATE momo_transactions SET status = $1 WHERE transaction_id = $2',
                ['FAILED', paymentRefId]
            );
        }

        res.status(500).json({
            error: 'Error processing payment',
            details: error.response?.data || error.message
        });
    }
});

// Get Payment Status
router.get('/payment-status/:transactionId', async (req, res) => {
    const transactionId = req.params.transactionId;

    try {
        // Get transaction from database
        const transactionResult = await query(
            'SELECT * FROM momo_transactions WHERE transaction_id = $1',
            [transactionId]
        );

        if (transactionResult.rows.length === 0) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        const transaction = transactionResult.rows[0];
        const momoTokenId = transaction.momo_token_id;

        // Get fresh status from MoMo
        const response = await axios.get(
            `https://${momoHost}/collection/v1_0/requesttopay/${transactionId}`,
            {
                headers: {
                    'Ocp-Apim-Subscription-Key': MOMO_SUBSCRIPTION_KEY,
                    'Authorization': `Bearer ${momoTokenId}`,
                    'X-Target-Environment': process.env.MOMO_ENV || 'sandbox'
                }
            }
        );

        // Update transaction status in database
        await query(
            'UPDATE momo_transactions SET status = $1, updated_at = NOW() WHERE transaction_id = $2',
            [response.data.status, transactionId]
        );

        res.status(200).json(response.data);
    } catch (error) {
        console.error('Error checking payment status:', error);
        res.status(500).json({
            error: 'Error checking payment status',
            details: error.response?.data || error.message
        });
    }
});

module.exports = router;
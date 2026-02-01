const crypto = require('crypto');

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SCOPES = 'read_products,write_products,read_orders,write_orders,read_inventory,write_inventory,read_product_listings';
const APP_URL = process.env.APP_URL || 'https://dash-board-vyntar.vercel.app';

function validateShopDomain(shop) {
  if (!shop) return false;
  const cleaned = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(cleaned);
}

function generateNonce(length) {
  return crypto.randomBytes(length || 16).toString('hex').slice(0, length || 16);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const shop = req.query.shop;
  if (!shop || !validateShopDomain(shop)) {
    return res.status(400).json({ error: 'Invalid shop domain. Must be like: mystore.myshopify.com' });
  }

  if (!SHOPIFY_API_KEY) {
    return res.status(500).json({ error: 'Missing SHOPIFY_API_KEY' });
  }

  const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const nonce = generateNonce(16);
  const redirectUri = APP_URL + '/api/auth/callback';

  const params = new URLSearchParams({
    client_id: SHOPIFY_API_KEY,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state: nonce
  });

  const installUrl = 'https://' + cleanShop + '/admin/oauth/authorize?' + params.toString();

  res.setHeader('Set-Cookie', 'shopify_nonce=' + nonce + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600');
  res.redirect(302, installUrl);
};

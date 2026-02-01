/**
 * Shopify Inventory Level Webhooks Handler
 * Handles inventory_levels/update
 * POST /api/webhooks/inventory
 */

const crypto = require('crypto');

const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hfchmjmhkiqsibxtiwsk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function verifyWebhookHmac(body, hmacHeader, secret) {
  if (!secret || !hmacHeader) return false;
  const computed = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
  return crypto.timingSafeEqual(Buffer.from(hmacHeader), Buffer.from(computed));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  const shopDomain = req.headers['x-shopify-shop-domain'];

  if (!shopDomain) {
    return res.status(400).json({ error: 'Missing shop domain header' });
  }

  if (SHOPIFY_API_SECRET && hmacHeader) {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const valid = verifyWebhookHmac(rawBody, hmacHeader, SHOPIFY_API_SECRET);
    if (!valid) {
      return res.status(401).json({ error: 'Webhook HMAC verification failed' });
    }
  }

  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  try {
    const { inventory_item_id, available, location_id } = req.body;

    if (!inventory_item_id) {
      return res.status(200).json({ success: true, skipped: true, reason: 'No inventory_item_id' });
    }

    // Get the shop's access token to look up which product this inventory item belongs to
    const shopUrl = `${SUPABASE_URL}/rest/v1/shops?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=access_token&is_active=eq.true`;
    const shopRes = await fetch(shopUrl, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    });
    const shops = await shopRes.json();
    const token = shops?.[0]?.access_token;

    if (!token) {
      return res.status(200).json({ success: true, skipped: true, reason: 'Shop not found' });
    }

    // Look up which variant/product this inventory item belongs to
    const variantRes = await fetch(
      `https://${shopDomain}/admin/api/2024-01/inventory_items/${inventory_item_id}.json`,
      { headers: { 'X-Shopify-Access-Token': token } }
    );

    if (!variantRes.ok) {
      return res.status(200).json({ success: true, skipped: true, reason: 'Inventory item not found' });
    }

    const inventoryItem = await variantRes.json();
    const variantId = inventoryItem.inventory_item?.variant_id;

    if (!variantId) {
      return res.status(200).json({ success: true, skipped: true, reason: 'No variant ID' });
    }

    // Get the variant to find the product ID
    const variantDetailRes = await fetch(
      `https://${shopDomain}/admin/api/2024-01/variants/${variantId}.json`,
      { headers: { 'X-Shopify-Access-Token': token } }
    );

    if (!variantDetailRes.ok) {
      return res.status(200).json({ success: true, skipped: true, reason: 'Variant not found' });
    }

    const variant = await variantDetailRes.json();
    const productId = variant.variant?.product_id;

    if (!productId) {
      return res.status(200).json({ success: true, skipped: true, reason: 'No product ID' });
    }

    // Update inventory in our database
    const updateUrl = `${SUPABASE_URL}/rest/v1/marketplace_products?shopify_product_id=eq.${productId}&shop_domain=eq.${encodeURIComponent(shopDomain)}`;
    const updateRes = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({
        inventory_quantity: available || 0,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });

    // Log event
    await fetch(`${SUPABASE_URL}/rest/v1/sync_logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({
        shop_domain: shopDomain,
        sync_type: 'webhook_inventory_update',
        items_synced: 1,
        items_failed: 0,
        status: 'success',
        details: JSON.stringify({ product_id: productId, available, location_id }),
        completed_at: new Date().toISOString()
      })
    });

    res.status(200).json({ success: true, product_id: productId, available });

  } catch (error) {
    console.error('Inventory webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed: ' + error.message });
  }
};

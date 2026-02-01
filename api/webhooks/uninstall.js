/**
 * Shopify App Uninstall Webhook Handler
 * Handles app/uninstalled topic
 * POST /api/webhooks/uninstall
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
    // Mark shop as inactive (don't delete data - merchant may reinstall)
    await fetch(
      `${SUPABASE_URL}/rest/v1/shops?shop_domain=eq.${encodeURIComponent(shopDomain)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({
          is_active: false,
          access_token: null,
          uninstalled_at: new Date().toISOString()
        })
      }
    );

    // Unpublish all marketplace listings for this shop
    await fetch(
      `${SUPABASE_URL}/rest/v1/marketplace_products?shop_domain=eq.${encodeURIComponent(shopDomain)}&marketplace_status=eq.listed`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({
          marketplace_status: 'not_listed',
          updated_at: new Date().toISOString()
        })
      }
    );

    // Log the uninstall
    await fetch(`${SUPABASE_URL}/rest/v1/sync_logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({
        shop_domain: shopDomain,
        sync_type: 'app_uninstalled',
        items_synced: 0,
        items_failed: 0,
        status: 'success',
        completed_at: new Date().toISOString()
      })
    });

    res.status(200).json({ success: true, action: 'uninstalled' });

  } catch (error) {
    console.error('Uninstall webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed: ' + error.message });
  }
};

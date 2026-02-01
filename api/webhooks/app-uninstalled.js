const crypto = require('crypto');

const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hfchmjmhkiqsibxtiwsk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function verifyWebhookHmac(rawBody, hmacHeader, secret) {
  if (!hmacHeader || !secret) return false;
  const generatedHmac = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');
  const generatedBuffer = Buffer.from(generatedHmac);
  const headerBuffer = Buffer.from(hmacHeader);
  if (generatedBuffer.length !== headerBuffer.length) return false;
  return crypto.timingSafeEqual(generatedBuffer, headerBuffer);
}

async function logSync(shopDomain, syncType, status, message) {
  await fetch(`${SUPABASE_URL}/rest/v1/sync_logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({
      shop_domain: shopDomain,
      sync_type: syncType,
      status: status,
      message: message,
      synced_at: new Date().toISOString(),
    }),
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const hmacHeader = req.headers['x-shopify-hmac-sha256'];
    const shopDomain = req.headers['x-shopify-shop-domain'];
    const topic = req.headers['x-shopify-topic'];

    if (!hmacHeader || !shopDomain) {
      return res.status(400).json({ error: 'Missing required Shopify headers' });
    }

    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    if (!verifyWebhookHmac(rawBody, hmacHeader, SHOPIFY_API_SECRET)) {
      return res.status(401).json({ error: 'HMAC verification failed' });
    }

    const patchResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/shops?shop_domain=eq.${encodeURIComponent(shopDomain)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          is_active: false,
          access_token: null,
          uninstalled_at: new Date().toISOString(),
          sync_enabled: false,
        }),
      }
    );

    await logSync(shopDomain, 'app_uninstalled', patchResponse.ok ? 'success' : 'error',
      `App uninstalled for shop ${shopDomain}`);

    return res.status(200).json({ success: true, message: 'App uninstall processed', shop: shopDomain });
  } catch (error) {
    console.error('App uninstall webhook error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

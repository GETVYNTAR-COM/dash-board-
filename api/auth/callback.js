const crypto = require('crypto');

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hfchmjmhkiqsibxtiwsk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const APP_URL = process.env.APP_URL || 'https://dash-board-vyntar.vercel.app';

function verifyHmac(query, secret) {
  const params = Object.assign({}, query);
  const hmac = params.hmac;
  delete params.hmac;

  const sortedKeys = Object.keys(params).sort();
  const message = sortedKeys.map(key => key + '=' + params[key]).join('&');

  const generatedHmac = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  const generatedBuffer = Buffer.from(generatedHmac, 'hex');
  const hmacBuffer = Buffer.from(hmac, 'hex');

  if (generatedBuffer.length !== hmacBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(generatedBuffer, hmacBuffer);
}

function validateShopDomain(shop) {
  const shopRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*.myshopify.com$/;
  return shopRegex.test(shop);
}

async function registerWebhook(shop, accessToken, topic, address) {
  const url = `https://${shop}/admin/api/2024-01/webhooks.json`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({
      webhook: {
        topic: topic,
        address: address,
        format: 'json',
      },
    }),
  });
  return response.json();
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code, hmac, shop, state } = req.query;

    if (!code || !hmac || !shop || !state) {
      return res.status(400).json({ error: 'Missing required parameters: code, hmac, shop, state' });
    }

    if (!validateShopDomain(shop)) {
      return res.status(400).json({ error: 'Invalid shop domain' });
    }

    if (!verifyHmac(req.query, SHOPIFY_API_SECRET)) {
      return res.status(401).json({ error: 'HMAC verification failed' });
    }

    const cookies = req.headers.cookie || '';
    const nonceCookie = cookies.split(';').find(c => c.trim().startsWith('shopify_nonce='));
    if (nonceCookie) {
      const savedNonce = nonceCookie.split('=')[1].trim();
      if (savedNonce !== state) {
        return res.status(403).json({ error: 'Nonce mismatch. Possible CSRF attack.' });
      }
    }

    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code: code,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      return res.status(500).json({ error: 'Failed to exchange code for access token', details: errorText });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    const scope = tokenData.scope;

    const shopResponse = await fetch(`https://${shop}/admin/api/2024-01/shop.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });

    if (!shopResponse.ok) {
      return res.status(500).json({ error: 'Failed to fetch shop info' });
    }

    const shopData = await shopResponse.json();
    const shopInfo = shopData.shop;

    const shopRecord = {
      shop_domain: shop,
      access_token: accessToken,
      scope: scope,
      shop_name: shopInfo.name || null,
      shop_email: shopInfo.email || null,
      shop_owner: shopInfo.shop_owner || null,
      currency: shopInfo.currency || null,
      timezone: shopInfo.iana_timezone || null,
      plan_name: shopInfo.plan_name || null,
      installed_at: new Date().toISOString(),
      is_active: true,
      fb_connected: false,
      sync_enabled: false,
    };

    const upsertResponse = await fetch(`${SUPABASE_URL}/rest/v1/shops`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(shopRecord),
    });

    if (!upsertResponse.ok) {
      const errText = await upsertResponse.text();
      console.error('Supabase upsert error:', errText);
    }

    const webhookTopics = [
      'products/create',
      'products/update',
      'products/delete',
      'orders/create',
      'orders/updated',
      'app/uninstalled',
    ];

    const webhookBase = APP_URL + '/api/webhooks';
    const webhookMap = {
      'products/create': webhookBase + '/products',
      'products/update': webhookBase + '/products',
      'products/delete': webhookBase + '/products',
      'orders/create': webhookBase + '/orders',
      'orders/updated': webhookBase + '/orders',
      'app/uninstalled': webhookBase + '/app-uninstalled',
    };

    for (const topic of webhookTopics) {
      try {
        await registerWebhook(shop, accessToken, topic, webhookMap[topic]);
      } catch (err) {
        console.error(`Failed to register webhook ${topic}:`, err.message);
      }
    }

    const redirectUrl = `${APP_URL}/app.html?shop=${encodeURIComponent(shop)}&installed=true`;
    return res.redirect(302, redirectUrl);
  } catch (error) {
    console.error('OAuth callback error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

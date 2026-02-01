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

function mapProductFields(shopDomain, product) {
  const firstVariant = product.variants && product.variants.length > 0 ? product.variants[0] : {};
  const firstImage = product.images && product.images.length > 0 ? product.images[0] : null;
  const imageUrls = (product.images || []).map(img => img.src);

  return {
    shop_domain: shopDomain,
    shopify_product_id: String(product.id),
    title: product.title || null,
    body_html: product.body_html || null,
    vendor: product.vendor || null,
    product_type: product.product_type || null,
    tags: product.tags || null,
    status: product.status || null,
    handle: product.handle || null,
    image_url: firstImage ? firstImage.src : null,
    images: JSON.stringify(imageUrls),
    price: firstVariant.price || null,
    compare_at_price: firstVariant.compare_at_price || null,
    sku: firstVariant.sku || null,
    barcode: firstVariant.barcode || null,
    inventory_quantity: firstVariant.inventory_quantity || 0,
    weight: firstVariant.weight || null,
    weight_unit: firstVariant.weight_unit || null,
    variants_count: product.variants ? product.variants.length : 0,
    variants_json: JSON.stringify(product.variants || []),
    shopify_created_at: product.created_at || null,
    shopify_updated_at: product.updated_at || null,
    synced_at: new Date().toISOString(),
  };
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

    if (!hmacHeader || !shopDomain || !topic) {
      return res.status(400).json({ error: 'Missing required Shopify headers' });
    }

    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    if (!verifyWebhookHmac(rawBody, hmacHeader, SHOPIFY_API_SECRET)) {
      return res.status(401).json({ error: 'HMAC verification failed' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const productId = String(body.id);

    if (topic === 'products/delete') {
      const deleteUrl = `${SUPABASE_URL}/rest/v1/product_mappings?shop_domain=eq.${encodeURIComponent(shopDomain)}&shopify_product_id=eq.${encodeURIComponent(productId)}`;
      const deleteResponse = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      });

      await logSync(shopDomain, 'webhook_product_delete', deleteResponse.ok ? 'success' : 'error',
        `Product ${productId} deleted via webhook`);

      return res.status(200).json({ success: true, action: 'deleted', product_id: productId });
    }

    if (topic === 'products/create' || topic === 'products/update') {
      const mapped = mapProductFields(shopDomain, body);

      const upsertResponse = await fetch(`${SUPABASE_URL}/rest/v1/product_mappings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify(mapped),
      });

      const action = topic === 'products/create' ? 'created' : 'updated';
      await logSync(shopDomain, `webhook_product_${action}`, upsertResponse.ok ? 'success' : 'error',
        `Product ${productId} ${action} via webhook`);

      return res.status(200).json({ success: true, action: action, product_id: productId });
    }

    return res.status(200).json({ success: true, message: 'Unhandled topic', topic: topic });
  } catch (error) {
    console.error('Products webhook error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

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

async function getMarketplaceProductIds(shopDomain) {
  const url = `${SUPABASE_URL}/rest/v1/product_mappings?shop_domain=eq.${encodeURIComponent(shopDomain)}&marketplace_status=eq.listed&select=shopify_product_id`;
  const response = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  const data = await response.json();
  return data.map(p => String(p.shopify_product_id));
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

    const order = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const listedProductIds = await getMarketplaceProductIds(shopDomain);
    const lineItems = order.line_items || [];

    const orderProductIds = lineItems.map(item => String(item.product_id));
    const hasMarketplaceProducts = orderProductIds.some(id => listedProductIds.includes(id));
    const orderTags = order.tags ? order.tags.toLowerCase() : '';
    const isMarketplaceSource = order.source_name === 'marketplace';
    const hasFbTag = orderTags.includes('fb-marketplace');

    const isMarketplaceOrder = hasMarketplaceProducts || isMarketplaceSource || hasFbTag;

    if (!isMarketplaceOrder) {
      return res.status(200).json({ success: true, message: 'Not a marketplace order, skipped' });
    }

    const customer = order.customer || {};
    const customerName = customer.first_name
      ? `${customer.first_name} ${customer.last_name || ''}`.trim()
      : (order.billing_address ? `${order.billing_address.first_name || ''} ${order.billing_address.last_name || ''}`.trim() : 'Unknown');

    const orderRecord = {
      shop_domain: shopDomain,
      shopify_order_id: String(order.id),
      order_number: order.order_number || null,
      order_name: order.name || null,
      customer_name: customerName,
      customer_email: customer.email || order.email || null,
      total_price: order.total_price || '0.00',
      subtotal_price: order.subtotal_price || '0.00',
      total_tax: order.total_tax || '0.00',
      currency: order.currency || 'USD',
      financial_status: order.financial_status || null,
      fulfillment_status: order.fulfillment_status || null,
      line_items_count: lineItems.length,
      line_items_json: JSON.stringify(lineItems),
      source: order.source_name || null,
      tags: order.tags || null,
      shopify_created_at: order.created_at || null,
      shopify_updated_at: order.updated_at || null,
      synced_at: new Date().toISOString(),
    };

    const upsertResponse = await fetch(`${SUPABASE_URL}/rest/v1/marketplace_orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(orderRecord),
    });

    for (const item of lineItems) {
      const productId = String(item.product_id);
      if (listedProductIds.includes(productId)) {
        const quantity = item.quantity || 0;
        const productUrl = `${SUPABASE_URL}/rest/v1/product_mappings?shop_domain=eq.${encodeURIComponent(shopDomain)}&shopify_product_id=eq.${encodeURIComponent(productId)}&select=inventory_quantity`;
        const productResponse = await fetch(productUrl, {
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          },
        });
        const productData = await productResponse.json();

        if (productData && productData.length > 0) {
          const currentQty = productData[0].inventory_quantity || 0;
          const newQty = Math.max(0, currentQty - quantity);

          await fetch(
            `${SUPABASE_URL}/rest/v1/product_mappings?shop_domain=eq.${encodeURIComponent(shopDomain)}&shopify_product_id=eq.${encodeURIComponent(productId)}`,
            {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
              },
              body: JSON.stringify({ inventory_quantity: newQty }),
            }
          );
        }
      }
    }

    const action = topic === 'orders/create' ? 'created' : 'updated';
    await logSync(shopDomain, `webhook_order_${action}`, upsertResponse.ok ? 'success' : 'error',
      `Marketplace order ${order.name || order.id} ${action} via webhook`);

    return res.status(200).json({ success: true, action: action, order_id: String(order.id) });
  } catch (error) {
    console.error('Orders webhook error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

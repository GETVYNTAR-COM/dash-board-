const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hfchmjmhkiqsibxtiwsk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function getShopToken(shopDomain) {
  const url = `${SUPABASE_URL}/rest/v1/shops?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=access_token,is_active`;
  const response = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  const data = await response.json();
  if (!data || data.length === 0) {
    throw new Error('Shop not found');
  }
  if (!data[0].is_active) {
    throw new Error('Shop is not active');
  }
  return data[0].access_token;
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

async function fetchRecentOrders(shop, accessToken) {
  const url = `https://${shop}/admin/api/2024-01/orders.json?status=any&limit=250`;
  const response = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': accessToken },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to fetch orders: ${response.status} ${errText}`);
  }

  const data = await response.json();
  return data.orders || [];
}

function isMarketplaceOrder(order, listedProductIds) {
  const lineItems = order.line_items || [];
  const orderProductIds = lineItems.map(item => String(item.product_id));
  const hasListedProducts = orderProductIds.some(id => listedProductIds.includes(id));

  const isMarketplaceSource = order.source_name === 'marketplace';
  const orderTags = order.tags ? order.tags.toLowerCase() : '';
  const hasFbTag = orderTags.includes('fb-marketplace');

  return hasListedProducts || isMarketplaceSource || hasFbTag;
}

function mapOrder(shopDomain, order) {
  const customer = order.customer || {};
  const lineItems = order.line_items || [];
  const customerName = customer.first_name
    ? `${customer.first_name} ${customer.last_name || ''}`.trim()
    : (order.billing_address ? `${order.billing_address.first_name || ''} ${order.billing_address.last_name || ''}`.trim() : 'Unknown');

  return {
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
}

module.exports = async (req, res) => {
  corsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { shop } = req.body || {};

    if (!shop) {
      return res.status(400).json({ error: 'Missing shop in request body' });
    }

    const accessToken = await getShopToken(shop);
    const listedProductIds = await getMarketplaceProductIds(shop);
    const allOrders = await fetchRecentOrders(shop, accessToken);

    const marketplaceOrders = allOrders.filter(order => isMarketplaceOrder(order, listedProductIds));
    const mappedOrders = marketplaceOrders.map(order => mapOrder(shop, order));

    let upserted = 0;
    let errors = 0;

    if (mappedOrders.length > 0) {
      const upsertResponse = await fetch(`${SUPABASE_URL}/rest/v1/marketplace_orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify(mappedOrders),
      });

      if (upsertResponse.ok) {
        upserted = mappedOrders.length;
      } else {
        const errText = await upsertResponse.text();
        console.error('Order upsert error:', errText);
        errors = mappedOrders.length;
      }
    }

    await fetch(`${SUPABASE_URL}/rest/v1/shops?shop_domain=eq.${encodeURIComponent(shop)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ last_order_sync: new Date().toISOString() }),
    });

    return res.status(200).json({
      success: true,
      total_orders_fetched: allOrders.length,
      marketplace_orders_found: marketplaceOrders.length,
      upserted: upserted,
      errors: errors,
    });
  } catch (error) {
    console.error('Order sync error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

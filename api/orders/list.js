/**
 * Orders List Endpoint
 * Returns orders for a given shop
 * GET /api/orders/list?shop=mystore.myshopify.com&status=all&page=1&limit=50
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hfchmjmhkiqsibxtiwsk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { shop, status, page, limit } = req.query;

  if (!shop) {
    return res.status(400).json({ error: 'Missing shop parameter' });
  }

  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  try {
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * pageSize;

    let url = `${SUPABASE_URL}/rest/v1/marketplace_orders?shop_domain=eq.${encodeURIComponent(shop)}`;

    if (status && status !== 'all') {
      url += `&financial_status=eq.${encodeURIComponent(status)}`;
    }

    url += `&order=shopify_created_at.desc&offset=${offset}&limit=${pageSize}`;

    const response = await fetch(url, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'count=exact'
      }
    });

    if (!response.ok) throw new Error(`Database error: ${response.status}`);

    const orders = await response.json();
    const total = parseInt(response.headers.get('content-range')?.split('/')?.[1] || '0');

    // Get order stats
    const statsUrl = `${SUPABASE_URL}/rest/v1/marketplace_orders?shop_domain=eq.${encodeURIComponent(shop)}&select=financial_status,fulfillment_status,total_price`;
    const statsRes = await fetch(statsUrl, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    });
    const allOrders = await statsRes.json();

    const stats = {
      total_orders: allOrders.length,
      total_revenue: allOrders.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0),
      paid: allOrders.filter(o => o.financial_status === 'paid').length,
      pending: allOrders.filter(o => o.financial_status === 'pending').length,
      refunded: allOrders.filter(o => o.financial_status === 'refunded').length,
      fulfilled: allOrders.filter(o => o.fulfillment_status === 'fulfilled').length,
      unfulfilled: allOrders.filter(o => !o.fulfillment_status || o.fulfillment_status === 'unfulfilled').length
    };

    res.status(200).json({
      orders,
      stats,
      pagination: {
        page: pageNum,
        limit: pageSize,
        total,
        pages: Math.ceil(total / pageSize)
      }
    });

  } catch (error) {
    console.error('List orders error:', error);
    res.status(500).json({ error: 'Failed to list orders: ' + error.message });
  }
};

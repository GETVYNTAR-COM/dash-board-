const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hfchmjmhkiqsibxtiwsk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  corsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { shop, status, page, limit } = req.query;

    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    const marketplaceStatus = status || 'listed';
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 25;
    const offset = (pageNum - 1) * limitNum;

    const allProductsUrl = `${SUPABASE_URL}/rest/v1/product_mappings?shop_domain=eq.${encodeURIComponent(shop)}&select=marketplace_status,price,inventory_quantity`;
    const allResponse = await fetch(allProductsUrl, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });

    if (!allResponse.ok) {
      const errText = await allResponse.text();
      return res.status(500).json({ error: 'Failed to fetch stats', details: errText });
    }

    const allProducts = await allResponse.json();

    const stats = {
      total_products: allProducts.length,
      listed: 0,
      not_listed: 0,
      pending: 0,
      errors: 0,
      total_value: 0,
      total_inventory: 0,
    };

    for (const p of allProducts) {
      switch (p.marketplace_status) {
        case 'listed':
          stats.listed++;
          break;
        case 'not_listed':
          stats.not_listed++;
          break;
        case 'pending':
          stats.pending++;
          break;
        case 'error':
          stats.errors++;
          break;
      }
      if (p.price) {
        stats.total_value += parseFloat(p.price) || 0;
      }
      stats.total_inventory += p.inventory_quantity || 0;
    }

    stats.total_value = Math.round(stats.total_value * 100) / 100;

    const listingsUrl = `${SUPABASE_URL}/rest/v1/product_mappings?shop_domain=eq.${encodeURIComponent(shop)}&marketplace_status=eq.${encodeURIComponent(marketplaceStatus)}&select=*&order=shopify_updated_at.desc&offset=${offset}&limit=${limitNum}`;
    const listingsResponse = await fetch(listingsUrl, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'count=exact',
      },
    });

    if (!listingsResponse.ok) {
      const errText = await listingsResponse.text();
      return res.status(500).json({ error: 'Failed to fetch listings', details: errText });
    }

    const listings = await listingsResponse.json();

    const contentRange = listingsResponse.headers.get('content-range');
    let totalCount = listings.length;
    if (contentRange) {
      const match = contentRange.match(/\/(\d+|\*)/);
      if (match && match[1] !== '*') {
        totalCount = parseInt(match[1], 10);
      }
    }

    const totalPages = Math.ceil(totalCount / limitNum);

    return res.status(200).json({
      success: true,
      listings: listings,
      stats: stats,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        total_pages: totalPages,
        has_next: pageNum < totalPages,
        has_prev: pageNum > 1,
      },
    });
  } catch (error) {
    console.error('Marketplace listings error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

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
    const { shop, status, page, limit, search } = req.query;

    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 25;
    const offset = (pageNum - 1) * limitNum;

    let filters = `shop_domain=eq.${encodeURIComponent(shop)}`;

    if (status) {
      filters += `&marketplace_status=eq.${encodeURIComponent(status)}`;
    }

    if (search) {
      const searchTerm = encodeURIComponent(`%${search}%`);
      filters += `&or=(title.ilike.${searchTerm},vendor.ilike.${searchTerm},sku.ilike.${searchTerm})`;
    }

    const countUrl = `${SUPABASE_URL}/rest/v1/product_mappings?${filters}&select=id`;
    const countResponse = await fetch(countUrl, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'count=exact',
        'Range-Unit': 'items',
        'Range': '0-0',
      },
    });

    const contentRange = countResponse.headers.get('content-range');
    let totalCount = 0;
    if (contentRange) {
      const match = contentRange.match(/\/(\d+|\*)/);
      if (match && match[1] !== '*') {
        totalCount = parseInt(match[1], 10);
      }
    }

    const dataUrl = `${SUPABASE_URL}/rest/v1/product_mappings?${filters}&select=*&order=shopify_updated_at.desc&offset=${offset}&limit=${limitNum}`;
    const dataResponse = await fetch(dataUrl, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });

    if (!dataResponse.ok) {
      const errText = await dataResponse.text();
      return res.status(500).json({ error: 'Failed to fetch products', details: errText });
    }

    const products = await dataResponse.json();

    const totalPages = Math.ceil(totalCount / limitNum);

    return res.status(200).json({
      success: true,
      products: products,
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
    console.error('Product list error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

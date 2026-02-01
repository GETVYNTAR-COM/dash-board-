const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hfchmjmhkiqsibxtiwsk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

async function fetchAllShopifyProducts(shop, accessToken) {
  let allProducts = [];
  let url = `https://${shop}/admin/api/2024-01/products.json?limit=250`;

  while (url) {
    const response = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to fetch products: ${response.status} ${errText}`);
    }

    const data = await response.json();
    allProducts = allProducts.concat(data.products || []);

    const linkHeader = response.headers.get('link');
    url = null;
    if (linkHeader) {
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel=next/);
      if (nextMatch) {
        url = nextMatch[1];
      }
    }
  }

  return allProducts;
}

function mapProduct(shopDomain, product) {
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
    marketplace_status: 'not_listed',
    fb_listing_id: null,
  };
}

module.exports = async (req, res) => {
  corsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const shop = req.query.shop;
      if (!shop) {
        return res.status(400).json({ error: 'Missing shop parameter' });
      }

      const url = `${SUPABASE_URL}/rest/v1/product_mappings?shop_domain=eq.${encodeURIComponent(shop)}&select=marketplace_status`;
      const response = await fetch(url, {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      });
      const products = await response.json();

      const counts = {
        total: products.length,
        not_listed: 0,
        listed: 0,
        pending: 0,
        error: 0,
      };

      for (const p of products) {
        if (counts[p.marketplace_status] !== undefined) {
          counts[p.marketplace_status]++;
        }
      }

      return res.status(200).json({ success: true, sync_status: counts });
    }

    if (req.method === 'POST') {
      const { shop } = req.body || {};
      if (!shop) {
        return res.status(400).json({ error: 'Missing shop in request body' });
      }

      const accessToken = await getShopToken(shop);
      const shopifyProducts = await fetchAllShopifyProducts(shop, accessToken);
      const mappedProducts = shopifyProducts.map(p => mapProduct(shop, p));

      let upserted = 0;
      let errors = 0;
      const batchSize = 50;

      for (let i = 0; i < mappedProducts.length; i += batchSize) {
        const batch = mappedProducts.slice(i, i + batchSize);

        const batchForUpsert = batch.map(p => {
          const copy = Object.assign({}, p);
          delete copy.marketplace_status;
          delete copy.fb_listing_id;
          return copy;
        });

        const upsertResponse = await fetch(`${SUPABASE_URL}/rest/v1/product_mappings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify(batchForUpsert),
        });

        if (upsertResponse.ok) {
          upserted += batch.length;
        } else {
          const errText = await upsertResponse.text();
          console.error('Batch upsert error:', errText);
          errors += batch.length;
        }
      }

      await fetch(`${SUPABASE_URL}/rest/v1/shops?shop_domain=eq.${encodeURIComponent(shop)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ last_product_sync: new Date().toISOString() }),
      });

      await fetch(`${SUPABASE_URL}/rest/v1/sync_logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          shop_domain: shop,
          sync_type: 'products',
          status: errors > 0 ? 'partial' : 'success',
          records_synced: upserted,
          records_failed: errors,
          message: `Synced ${upserted} products from Shopify (${errors} errors)`,
          synced_at: new Date().toISOString(),
        }),
      });

      return res.status(200).json({
        success: true,
        total_fetched: shopifyProducts.length,
        upserted: upserted,
        errors: errors,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Product sync error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

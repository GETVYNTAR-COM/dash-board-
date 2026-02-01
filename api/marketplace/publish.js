const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hfchmjmhkiqsibxtiwsk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
const FB_CATALOG_ID = process.env.FB_CATALOG_ID;
const FB_GRAPH_API = process.env.FB_GRAPH_API || 'https://graph.facebook.com/v19.0';

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function getShopSettings(shopDomain) {
  const url = `${SUPABASE_URL}/rest/v1/shops?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=*`;
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
  return data[0];
}

async function getProducts(shopDomain, productIds) {
  const idsFilter = productIds.map(id => `"${id}"`).join(',');
  const url = `${SUPABASE_URL}/rest/v1/product_mappings?shop_domain=eq.${encodeURIComponent(shopDomain)}&shopify_product_id=in.(${productIds.join(',')})`;
  const response = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch products');
  }
  return response.json();
}

function buildFbProductData(product, shopSettings) {
  const description = stripHtml(product.body_html) || product.title;
  const price = product.price ? Math.round(parseFloat(product.price) * 100) : 0;
  const currency = shopSettings.currency || 'USD';

  return {
    retailer_id: product.shopify_product_id,
    name: product.title || 'Untitled Product',
    description: description,
    availability: product.inventory_quantity > 0 ? 'in stock' : 'out of stock',
    condition: 'new',
    price: `${price} ${currency}`,
    image_url: product.image_url || '',
    brand: product.vendor || shopSettings.shop_name || 'Unknown',
    category: product.product_type || 'Other',
    inventory: product.inventory_quantity || 0,
  };
}

async function updateProductStatus(shopDomain, productId, status, fbListingId, lastError) {
  const updateData = {
    marketplace_status: status,
    fb_listing_id: fbListingId || null,
    last_error: lastError || null,
    updated_at: new Date().toISOString(),
  };

  await fetch(
    `${SUPABASE_URL}/rest/v1/product_mappings?shop_domain=eq.${encodeURIComponent(shopDomain)}&shopify_product_id=eq.${encodeURIComponent(productId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify(updateData),
    }
  );
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
  corsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { shop, product_ids, action } = req.body || {};

    if (!shop || !product_ids || !Array.isArray(product_ids) || product_ids.length === 0) {
      return res.status(400).json({ error: 'Missing required fields: shop, product_ids (array)' });
    }

    if (!['publish', 'unpublish', 'update'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Must be publish, unpublish, or update' });
    }

    const shopSettings = await getShopSettings(shop);
    const products = await getProducts(shop, product_ids);

    if (products.length === 0) {
      return res.status(404).json({ error: 'No products found with the given IDs' });
    }

    const results = { succeeded: 0, failed: 0, errors: [] };

    for (const product of products) {
      try {
        if (action === 'publish' || action === 'update') {
          const fbData = buildFbProductData(product, shopSettings);
          const fbUrl = `${FB_GRAPH_API}/${FB_CATALOG_ID}/products`;

          const fbResponse = await fetch(fbUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${FB_ACCESS_TOKEN}`,
            },
            body: JSON.stringify(fbData),
          });

          const fbResult = await fbResponse.json();

          if (fbResponse.ok) {
            const listingId = fbResult.id || product.fb_listing_id || null;
            await updateProductStatus(shop, product.shopify_product_id, 'listed', listingId, null);
            results.succeeded++;
          } else {
            const errorMsg = fbResult.error ? fbResult.error.message : 'Unknown FB API error';
            await updateProductStatus(shop, product.shopify_product_id, 'error', product.fb_listing_id, errorMsg);
            results.failed++;
            results.errors.push({ product_id: product.shopify_product_id, error: errorMsg });
          }
        } else if (action === 'unpublish') {
          if (product.fb_listing_id) {
            const fbUrl = `${FB_GRAPH_API}/${product.fb_listing_id}`;

            const fbResponse = await fetch(fbUrl, {
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${FB_ACCESS_TOKEN}`,
              },
            });

            if (!fbResponse.ok) {
              const fbResult = await fbResponse.json();
              const errorMsg = fbResult.error ? fbResult.error.message : 'Failed to delete from FB';
              await updateProductStatus(shop, product.shopify_product_id, 'error', product.fb_listing_id, errorMsg);
              results.failed++;
              results.errors.push({ product_id: product.shopify_product_id, error: errorMsg });
              continue;
            }
          }

          await updateProductStatus(shop, product.shopify_product_id, 'not_listed', null, null);
          results.succeeded++;
        }
      } catch (productError) {
        await updateProductStatus(shop, product.shopify_product_id, 'error', product.fb_listing_id, productError.message);
        results.failed++;
        results.errors.push({ product_id: product.shopify_product_id, error: productError.message });
      }
    }

    const logStatus = results.failed > 0 ? (results.succeeded > 0 ? 'partial' : 'error') : 'success';
    await logSync(shop, `marketplace_${action}`, logStatus, `${action}: ${results.succeeded} succeeded, ${results.failed} failed`);

    return res.status(200).json({
      success: true,
      action: action,
      results: results,
    });
  } catch (error) {
    console.error('Marketplace publish error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

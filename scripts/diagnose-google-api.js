#!/usr/bin/env node

/**
 * Google Custom Search API Diagnostic Script
 *
 * Tests API key validity, API enablement, and makes test queries
 * to identify exactly why Custom Search API calls are failing.
 */

const API_KEY = 'AIzaSyCazMJx7IZNBPEy4IbzmM5agFcCdAWFGJo';
const SEARCH_ENGINE_ID = 'f0fd954daa920451f';
const TEST_QUERY = 'PIPEWORKS MANCHESTER LTD site:yell.com';

// Rate limiting helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'bold');
  console.log('='.repeat(60));
}

function logResult(test, passed, details = '') {
  const status = passed ? `${colors.green}PASS` : `${colors.red}FAIL`;
  console.log(`${status}${colors.reset} - ${test}`);
  if (details) {
    console.log(`     ${colors.cyan}${details}${colors.reset}`);
  }
}

// Error code explanations
const ERROR_EXPLANATIONS = {
  400: {
    title: 'Bad Request',
    causes: [
      'Invalid Search Engine ID (cx parameter)',
      'Malformed query string',
      'Missing required parameters',
    ],
    fixes: [
      'Verify Search Engine ID in Google Programmable Search Engine console',
      'Check that the cx parameter matches your search engine exactly',
      'Ensure query is properly URL-encoded',
    ],
  },
  403: {
    title: 'Forbidden',
    causes: [
      'Custom Search API not enabled for this Google Cloud project',
      'API key restrictions blocking the request',
      'Billing not enabled on the Google Cloud project',
      'API key belongs to a different project than the Search Engine',
    ],
    fixes: [
      'Go to Google Cloud Console > APIs & Services > Enable APIs',
      'Search for "Custom Search API" and click ENABLE',
      'Check API key restrictions (IP, referrer, API restrictions)',
      'Ensure billing is enabled on your Google Cloud project',
      'Verify the API key and Search Engine are in the same project',
    ],
  },
  429: {
    title: 'Too Many Requests',
    causes: [
      'Daily quota exceeded (100 queries/day on free tier)',
      'Rate limit exceeded (queries per second)',
    ],
    fixes: [
      'Wait until quota resets (midnight Pacific Time)',
      'Upgrade to paid tier for more queries',
      'Add delays between API calls',
    ],
  },
  401: {
    title: 'Unauthorized',
    causes: [
      'Invalid API key',
      'API key has been deleted or disabled',
    ],
    fixes: [
      'Generate a new API key in Google Cloud Console',
      'Check that the key is not restricted to other APIs only',
    ],
  },
};

async function testApiKeyFormat() {
  logSection('TEST 1: API Key Format Validation');

  const keyPattern = /^AIza[0-9A-Za-z_-]{35}$/;
  const isValidFormat = keyPattern.test(API_KEY);

  logResult('API key format', isValidFormat,
    isValidFormat
      ? `Key starts with AIza and is correct length (${API_KEY.length} chars)`
      : `Invalid format. Expected AIza... with 39 chars, got ${API_KEY.length} chars`
  );

  console.log(`\n  API Key: ${API_KEY.slice(0, 10)}...${API_KEY.slice(-4)}`);
  console.log(`  Length: ${API_KEY.length} characters`);

  return isValidFormat;
}

async function testSearchEngineId() {
  logSection('TEST 2: Search Engine ID Validation');

  // Search Engine IDs are typically 17-21 characters
  const isValidLength = SEARCH_ENGINE_ID.length >= 10 && SEARCH_ENGINE_ID.length <= 50;

  logResult('Search Engine ID format', isValidLength,
    `ID: ${SEARCH_ENGINE_ID} (${SEARCH_ENGINE_ID.length} chars)`
  );

  // Check for common format patterns
  const hasColons = SEARCH_ENGINE_ID.includes(':');
  console.log(`\n  Contains colons: ${hasColons ? 'Yes (old format)' : 'No (new format)'}`);

  return isValidLength;
}

async function testCustomSearchApiDirect() {
  logSection('TEST 3: Direct Custom Search API Call');

  const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(TEST_QUERY)}`;

  console.log(`\nTest Query: "${TEST_QUERY}"`);
  console.log(`Full URL: ${url.replace(API_KEY, 'API_KEY_HIDDEN')}`);
  console.log('\nMaking request...\n');

  try {
    const response = await fetch(url);
    const data = await response.json();

    console.log(`HTTP Status: ${response.status} ${response.statusText}`);

    if (response.ok) {
      logResult('Custom Search API call', true, `Found ${data.items?.length || 0} results`);

      if (data.searchInformation) {
        console.log(`\n  Total Results: ${data.searchInformation.totalResults}`);
        console.log(`  Search Time: ${data.searchInformation.searchTime}s`);
      }

      if (data.items && data.items.length > 0) {
        console.log('\n  First result:');
        console.log(`    Title: ${data.items[0].title}`);
        console.log(`    Link: ${data.items[0].link}`);
      }

      return { success: true, data };
    } else {
      logResult('Custom Search API call', false, `HTTP ${response.status}`);

      // Parse error
      if (data.error) {
        console.log(`\n  Error Code: ${data.error.code}`);
        console.log(`  Error Message: ${data.error.message}`);
        console.log(`  Error Status: ${data.error.status || 'N/A'}`);

        if (data.error.errors) {
          console.log('\n  Error Details:');
          data.error.errors.forEach((err, i) => {
            console.log(`    [${i + 1}] Domain: ${err.domain}`);
            console.log(`        Reason: ${err.reason}`);
            console.log(`        Message: ${err.message}`);
          });
        }

        // Provide explanation
        const explanation = ERROR_EXPLANATIONS[data.error.code];
        if (explanation) {
          console.log(`\n  ${colors.yellow}--- Error Explanation ---${colors.reset}`);
          console.log(`  ${colors.bold}${explanation.title}${colors.reset}`);
          console.log('\n  Possible Causes:');
          explanation.causes.forEach(cause => console.log(`    - ${cause}`));
          console.log('\n  Suggested Fixes:');
          explanation.fixes.forEach(fix => console.log(`    - ${fix}`));
        }
      }

      return { success: false, data, status: response.status };
    }
  } catch (error) {
    logResult('Custom Search API call', false, error.message);
    console.log('\n  Network error or invalid response');
    console.log(`  Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function testSimpleQuery() {
  logSection('TEST 4: Simple Query (without site: restriction)');

  await sleep(500);

  const simpleQuery = 'test';
  const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(simpleQuery)}`;

  console.log(`\nTest Query: "${simpleQuery}"`);
  console.log('Making request...\n');

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (response.ok) {
      logResult('Simple query', true, `Found ${data.items?.length || 0} results`);
      return { success: true };
    } else {
      logResult('Simple query', false, `HTTP ${response.status}: ${data.error?.message || 'Unknown error'}`);
      return { success: false, status: response.status };
    }
  } catch (error) {
    logResult('Simple query', false, error.message);
    return { success: false, error: error.message };
  }
}

async function testAlternativeEndpoint() {
  logSection('TEST 5: Alternative API Endpoint (googleapis.com/customsearch)');

  await sleep(500);

  // Try the alternative endpoint format
  const url = `https://customsearch.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${SEARCH_ENGINE_ID}&q=test`;

  console.log('\nTrying alternative endpoint: customsearch.googleapis.com');
  console.log('Making request...\n');

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (response.ok) {
      logResult('Alternative endpoint', true, `Found ${data.items?.length || 0} results`);
      return { success: true };
    } else {
      logResult('Alternative endpoint', false, `HTTP ${response.status}: ${data.error?.message || 'Unknown error'}`);
      return { success: false, status: response.status };
    }
  } catch (error) {
    logResult('Alternative endpoint', false, error.message);
    return { success: false, error: error.message };
  }
}

async function checkQuotaStatus() {
  logSection('TEST 6: Quota/Billing Status Check');

  console.log('\nNote: Cannot directly check quota via API without OAuth.');
  console.log('However, 429 errors indicate quota exhaustion.\n');

  console.log('To check quota manually:');
  console.log('  1. Go to: https://console.cloud.google.com/apis/api/customsearch.googleapis.com/quotas');
  console.log('  2. Check "Queries per day" usage');
  console.log('  3. Free tier: 100 queries/day');
  console.log('  4. Quota resets at midnight Pacific Time');

  return { success: true, manual: true };
}

async function generateDiagnosticReport(results) {
  logSection('DIAGNOSTIC SUMMARY');

  const allPassed = results.apiKeyFormat && results.searchEngineId && results.customSearch?.success;

  if (allPassed) {
    log('\nAll tests passed! The API is working correctly.', 'green');
  } else {
    log('\nIssues detected. See recommendations below.', 'red');
  }

  console.log('\n--- Test Results ---');
  console.log(`  API Key Format:     ${results.apiKeyFormat ? 'PASS' : 'FAIL'}`);
  console.log(`  Search Engine ID:   ${results.searchEngineId ? 'PASS' : 'FAIL'}`);
  console.log(`  Custom Search API:  ${results.customSearch?.success ? 'PASS' : 'FAIL'}`);
  console.log(`  Simple Query:       ${results.simpleQuery?.success ? 'PASS' : 'FAIL'}`);
  console.log(`  Alt Endpoint:       ${results.altEndpoint?.success ? 'PASS' : 'FAIL'}`);

  // Specific recommendations based on failure type
  if (!results.customSearch?.success) {
    console.log('\n--- RECOMMENDED ACTIONS ---\n');

    const status = results.customSearch?.status;

    if (status === 403) {
      log('The 403 error indicates the API is not properly enabled or accessible.', 'yellow');
      console.log('\nStep-by-step fix:');
      console.log('');
      console.log('1. VERIFY API IS ENABLED:');
      console.log('   - Go to: https://console.cloud.google.com/apis/library/customsearch.googleapis.com');
      console.log('   - Click "ENABLE" if not already enabled');
      console.log('   - Wait 5 minutes for changes to propagate');
      console.log('');
      console.log('2. CHECK API KEY RESTRICTIONS:');
      console.log('   - Go to: https://console.cloud.google.com/apis/credentials');
      console.log('   - Click on your API key');
      console.log('   - Under "API restrictions", ensure "Custom Search API" is allowed');
      console.log('   - Or set to "Don\'t restrict key" for testing');
      console.log('');
      console.log('3. VERIFY BILLING:');
      console.log('   - Go to: https://console.cloud.google.com/billing');
      console.log('   - Ensure a billing account is linked to your project');
      console.log('   - Note: Free tier still requires billing to be enabled');
      console.log('');
      console.log('4. CHECK SEARCH ENGINE SETUP:');
      console.log('   - Go to: https://programmablesearchengine.google.com/');
      console.log('   - Verify your Search Engine ID matches: ' + SEARCH_ENGINE_ID);
      console.log('   - Check "Search the entire web" is enabled if needed');
      console.log('');
      console.log('5. CREATE NEW API KEY (if issues persist):');
      console.log('   - Go to: https://console.cloud.google.com/apis/credentials');
      console.log('   - Click "CREATE CREDENTIALS" > "API key"');
      console.log('   - Update GOOGLE_SEARCH_API_KEY in Vercel env vars');
    }

    if (status === 429) {
      log('The 429 error indicates quota exhaustion.', 'yellow');
      console.log('\nOptions:');
      console.log('  1. Wait until midnight Pacific Time for quota reset');
      console.log('  2. Upgrade to paid tier ($5 per 1000 queries)');
      console.log('  3. Create a new Google Cloud project with fresh quota');
    }

    if (status === 400) {
      log('The 400 error indicates invalid parameters.', 'yellow');
      console.log('\nCheck:');
      console.log('  1. Search Engine ID is correct');
      console.log('  2. Query string is properly formatted');
    }
  }

  // Raw data dump
  console.log('\n--- RAW API RESPONSE ---');
  if (results.customSearch?.data) {
    console.log(JSON.stringify(results.customSearch.data, null, 2));
  }
}

async function main() {
  console.log('\n');
  log('Google Custom Search API Diagnostic Tool', 'bold');
  console.log('========================================\n');

  console.log(`API Key: ${API_KEY.slice(0, 10)}...${API_KEY.slice(-4)}`);
  console.log(`Search Engine ID: ${SEARCH_ENGINE_ID}`);
  console.log(`Test Query: ${TEST_QUERY}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const results = {};

  // Run all tests
  results.apiKeyFormat = await testApiKeyFormat();
  await sleep(500);

  results.searchEngineId = await testSearchEngineId();
  await sleep(500);

  results.customSearch = await testCustomSearchApiDirect();
  await sleep(500);

  results.simpleQuery = await testSimpleQuery();
  await sleep(500);

  results.altEndpoint = await testAlternativeEndpoint();
  await sleep(500);

  await checkQuotaStatus();

  // Generate final report
  await generateDiagnosticReport(results);

  console.log('\n');
}

main().catch(console.error);

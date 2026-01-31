const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ─── Load the HTML file ───
const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

// ─── Extract the JavaScript block from the HTML ───
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
const jsCode = scriptMatch ? scriptMatch[1] : '';

// ─── Helper: extract JS functions as strings for analysis ───
function extractFunction(name) {
  // Matches both `function name(` and `const name = (`
  const regex = new RegExp(`(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=)[\\s\\S]*?(?=\\n\\s{8}(?:function\\s|(?:const|let|var)\\s+\\w+\\s*=\\s*(?:\\{|\\(|function))|\\n\\s{8}\\/\\/ ──|$)`);
  const match = jsCode.match(regex);
  return match ? match[0] : null;
}

// ═══════════════════════════════════════════════════════════
// 1. HTML STRUCTURE TESTS
// ═══════════════════════════════════════════════════════════
describe('HTML Structure', () => {
  it('should have a valid DOCTYPE declaration', () => {
    assert.ok(html.startsWith('<!DOCTYPE html>'), 'Missing DOCTYPE');
  });

  it('should have proper html lang attribute', () => {
    assert.ok(html.includes('<html lang="en">'), 'Missing or incorrect lang attribute');
  });

  it('should have meta charset UTF-8', () => {
    assert.ok(html.includes('<meta charset="UTF-8">'), 'Missing charset meta tag');
  });

  it('should have viewport meta tag for responsive design', () => {
    assert.ok(
      html.includes('name="viewport"') && html.includes('width=device-width'),
      'Missing or incomplete viewport meta tag'
    );
  });

  it('should have a page title', () => {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    assert.ok(titleMatch, 'Missing title tag');
    assert.ok(titleMatch[1].length > 0, 'Title tag is empty');
  });

  it('should load Tailwind CSS from CDN', () => {
    assert.ok(html.includes('cdn.tailwindcss.com'), 'Tailwind CSS CDN not found');
  });

  it('should load Supabase JS SDK from CDN', () => {
    assert.ok(html.includes('supabase-js@2'), 'Supabase JS SDK not found');
  });
});

// ═══════════════════════════════════════════════════════════
// 2. DASHBOARD UI COMPONENTS
// ═══════════════════════════════════════════════════════════
describe('Dashboard UI Components', () => {
  it('should have a header with branding', () => {
    assert.ok(html.includes('VYNTAR Marketplace'), 'Missing branding in header');
  });

  it('should have a connection status indicator', () => {
    assert.ok(html.includes('Connected'), 'Missing connection status');
    assert.ok(html.includes('bg-green-500'), 'Missing green status dot');
  });

  it('should have all 5 stat cards', () => {
    const statIds = ['totalLeads', 'newLeads', 'contactedLeads', 'qualifiedLeads', 'convertedLeads'];
    for (const id of statIds) {
      assert.ok(html.includes(`id="${id}"`), `Missing stat card: ${id}`);
    }
  });

  it('should have stat cards with correct labels', () => {
    const labels = ['TOTAL LEADS', 'NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED'];
    for (const label of labels) {
      assert.ok(html.includes(label), `Missing stat label: ${label}`);
    }
  });

  it('should have an Add Lead form with required fields', () => {
    assert.ok(html.includes('id="addLeadForm"'), 'Missing add lead form');
    assert.ok(html.includes('id="buyerName"'), 'Missing buyer name field');
    assert.ok(html.includes('id="buyerEmail"'), 'Missing buyer email field');
    assert.ok(html.includes('id="buyerPhone"'), 'Missing buyer phone field');
    assert.ok(html.includes('id="leadScore"'), 'Missing lead score field');
    assert.ok(html.includes('id="leadMessage"'), 'Missing lead message field');
  });

  it('should have buyer name marked as required', () => {
    // Check that buyerName input has required attribute
    const nameInputRegex = /id="buyerName"[^>]*required/;
    assert.ok(nameInputRegex.test(html), 'Buyer name field should be required');
  });

  it('should have email field with type="email"', () => {
    assert.ok(html.includes('type="email" id="buyerEmail"'), 'Email field should have type="email"');
  });

  it('should have score field with min/max constraints', () => {
    assert.ok(html.includes('min="0"'), 'Score field missing min constraint');
    assert.ok(html.includes('max="100"'), 'Score field missing max constraint');
  });

  it('should have a leads table with correct columns', () => {
    const columns = ['Buyer', 'Contact', 'Status', 'Score', 'Source', 'Added', 'Delete'];
    for (const col of columns) {
      assert.ok(html.includes(col), `Missing table column: ${col}`);
    }
  });

  it('should have a search input', () => {
    assert.ok(html.includes('id="searchInput"'), 'Missing search input');
    assert.ok(html.includes('placeholder="Search leads..."'), 'Missing search placeholder');
  });

  it('should have a refresh button', () => {
    assert.ok(html.includes('onclick="loadLeads()"'), 'Missing refresh button with loadLeads()');
  });

  it('should have a delete confirmation modal', () => {
    assert.ok(html.includes('id="deleteModal"'), 'Missing delete modal');
    assert.ok(html.includes('id="deleteBuyerName"'), 'Missing delete buyer name span');
    assert.ok(html.includes('confirmDeleteLead()'), 'Missing confirmDeleteLead handler');
    assert.ok(html.includes('closeDeleteModal()'), 'Missing closeDeleteModal handler');
  });

  it('should have a toast notification element', () => {
    assert.ok(html.includes('id="toast"'), 'Missing toast element');
    assert.ok(html.includes('id="toastMessage"'), 'Missing toast message element');
  });

  it('should have a footer with contact info', () => {
    assert.ok(html.includes('VYNTAR Growth Solutions'), 'Missing footer branding');
    assert.ok(html.includes('vyntar@vyntaraiagent.com'), 'Missing contact email');
  });

  it('should have the form initially hidden', () => {
    assert.ok(html.includes('id="addLeadForm" class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 hidden"'),
      'Add lead form should be initially hidden');
  });

  it('should have the delete modal initially hidden', () => {
    assert.ok(html.includes('id="deleteModal" class="hidden'), 'Delete modal should be initially hidden');
  });
});

// ═══════════════════════════════════════════════════════════
// 3. JAVASCRIPT FUNCTION TESTS (static analysis)
// ═══════════════════════════════════════════════════════════
describe('JavaScript - Status Configuration', () => {
  it('should define all 5 statuses', () => {
    const statuses = ['new', 'contacted', 'qualified', 'converted', 'lost'];
    for (const status of statuses) {
      assert.ok(jsCode.includes(`'${status}':`), `Missing status config: ${status}`);
    }
  });

  it('should have label, bg, text, dot for each status', () => {
    // Check the statusConfig object has all required properties
    const configProps = ['label', 'bg', 'text', 'dot'];
    for (const prop of configProps) {
      // Should appear 5 times (once per status)
      const count = (jsCode.match(new RegExp(`${prop}:`, 'g')) || []).length;
      assert.ok(count >= 5, `Status config property '${prop}' should appear at least 5 times, found ${count}`);
    }
  });
});

describe('JavaScript - escapeHtml function', () => {
  it('should exist and handle null/empty input', () => {
    assert.ok(jsCode.includes('function escapeHtml(text)'), 'Missing escapeHtml function');
    assert.ok(jsCode.includes("if (!text) return ''"), 'escapeHtml should handle falsy input');
  });

  it('should use DOM-based escaping (secure method)', () => {
    assert.ok(jsCode.includes("document.createElement('div')"), 'Should use DOM-based HTML escaping');
    assert.ok(jsCode.includes('div.textContent = text'), 'Should set textContent for escaping');
    assert.ok(jsCode.includes('div.innerHTML'), 'Should read innerHTML for escaped output');
  });
});

describe('JavaScript - escapeJsString function', () => {
  it('should exist and handle null/undefined', () => {
    assert.ok(jsCode.includes('function escapeJsString(str)'), 'Missing escapeJsString function');
    assert.ok(jsCode.includes('str === null || str === undefined'), 'Should handle null/undefined');
  });

  it('should escape backslashes', () => {
    // The code has .replace(/\\/g, '\\\\') - check for the replace call with backslash pattern
    assert.ok(jsCode.includes('.replace(/'), 'Should have replace calls for escaping');
    assert.ok(jsCode.includes("'\\\\\\\\')"), 'Should escape backslashes with double-backslash replacement');
  });

  it('should escape single quotes', () => {
    assert.ok(jsCode.includes(".replace(/'/g,"), 'Should escape single quotes');
  });

  it('should escape HTML angle brackets for script injection prevention', () => {
    assert.ok(jsCode.includes("\\\\x3c"), 'Should escape < as \\x3c');
    assert.ok(jsCode.includes("\\\\x3e"), 'Should escape > as \\x3e');
  });
});

describe('JavaScript - formatDate function', () => {
  it('should exist and handle different time ranges', () => {
    assert.ok(jsCode.includes('function formatDate(dateString)'), 'Missing formatDate function');
  });

  it('should handle "just now" for very recent dates', () => {
    assert.ok(jsCode.includes("'Just now'"), 'Should return "Just now" for < 1 minute');
  });

  it('should handle minutes ago', () => {
    assert.ok(jsCode.includes("m ago"), 'Should show minutes ago');
  });

  it('should handle hours ago', () => {
    assert.ok(jsCode.includes("h ago"), 'Should show hours ago');
  });

  it('should handle days ago', () => {
    assert.ok(jsCode.includes("d ago"), 'Should show days ago');
  });

  it('should fall back to locale date string for older dates', () => {
    assert.ok(jsCode.includes('toLocaleDateString()'), 'Should fallback to locale date for > 7 days');
  });
});

describe('JavaScript - showToast function', () => {
  it('should exist and set message', () => {
    assert.ok(jsCode.includes('function showToast(message)'), 'Missing showToast function');
    assert.ok(jsCode.includes('toastMessage.textContent = message'), 'Should set toast message via textContent (XSS safe)');
  });

  it('should show and auto-hide the toast', () => {
    assert.ok(jsCode.includes("toast.classList.remove('hidden')"), 'Should show toast');
    assert.ok(jsCode.includes("toast.classList.add('hidden')"), 'Should hide toast');
    assert.ok(jsCode.includes('setTimeout'), 'Should use setTimeout for auto-hide');
  });
});

// ═══════════════════════════════════════════════════════════
// 4. CRUD OPERATIONS
// ═══════════════════════════════════════════════════════════
describe('JavaScript - CRUD Operations', () => {
  it('should have loadLeads function that queries Supabase', () => {
    assert.ok(jsCode.includes('async function loadLeads()'), 'Missing loadLeads function');
    assert.ok(jsCode.includes(".from('leads')"), 'Should query leads table');
    assert.ok(jsCode.includes(".select('*')"), 'Should select all columns');
    assert.ok(jsCode.includes("ascending: false"), 'Should order descending (newest first)');
  });

  it('should have form submit handler for adding leads', () => {
    assert.ok(jsCode.includes("addLeadForm"), 'Missing form reference');
    assert.ok(jsCode.includes("'submit'"), 'Missing submit event listener');
    assert.ok(jsCode.includes(".insert("), 'Should use insert for adding leads');
  });

  it('should collect all form fields when adding a lead', () => {
    const fields = ['buyerName', 'buyerEmail', 'buyerPhone', 'leadMessage', 'leadScore'];
    for (const field of fields) {
      assert.ok(jsCode.includes(`getElementById('${field}')`), `Should read ${field} from form`);
    }
  });

  it('should set default values for new leads', () => {
    assert.ok(jsCode.includes("status: 'new'"), 'New leads should default to status: new');
    assert.ok(jsCode.includes("source: 'manual'"), 'Manual leads should have source: manual');
    assert.ok(jsCode.includes("'manual_' + Date.now()"), 'Should generate thread_id');
  });

  it('should have updateLeadStatus function', () => {
    assert.ok(jsCode.includes('async function updateLeadStatus(leadId, newStatus)'), 'Missing updateLeadStatus');
  });

  it('should have RLS fallback mechanism for status updates', () => {
    assert.ok(jsCode.includes('delete + re-insert'), 'Should mention delete + re-insert fallback');
    assert.ok(jsCode.includes('.delete()'), 'Should have delete operation for fallback');
    // Check for the restoration logic if insert fails
    assert.ok(jsCode.includes('could not restore lead'), 'Should have restore logic if fallback fails');
  });

  it('should verify status update actually persisted', () => {
    assert.ok(jsCode.includes('verifyData'), 'Should verify update with a re-read');
    assert.ok(jsCode.includes('verifyData.status !== newStatus'), 'Should check if status actually changed');
  });

  it('should have confirmDeleteLead function', () => {
    assert.ok(jsCode.includes('async function confirmDeleteLead()'), 'Missing confirmDeleteLead');
    assert.ok(jsCode.includes(".delete()"), 'Should use delete for removing leads');
    assert.ok(jsCode.includes(".eq('id', deleteLeadId)"), 'Should delete by lead ID');
  });

  it('should disable submit button during add operation', () => {
    assert.ok(jsCode.includes('submitBtn.disabled = true'), 'Should disable button during submission');
    assert.ok(jsCode.includes("submitBtn.textContent = 'Adding...'"), 'Should show loading text');
    assert.ok(jsCode.includes('submitBtn.disabled = false'), 'Should re-enable button after submission');
  });

  it('should reset form after successful add', () => {
    assert.ok(jsCode.includes("addLeadForm').reset()"), 'Should reset form after adding lead');
  });
});

// ═══════════════════════════════════════════════════════════
// 5. SEARCH FUNCTIONALITY
// ═══════════════════════════════════════════════════════════
describe('JavaScript - Search', () => {
  it('should have search input event listener', () => {
    assert.ok(jsCode.includes("searchInput"), 'Missing search input reference');
    assert.ok(jsCode.includes("'input'"), 'Should listen for input events');
  });

  it('should search across multiple fields', () => {
    const searchFields = ['buyer_name', 'buyer_email', 'buyer_phone', 'message'];
    for (const field of searchFields) {
      assert.ok(jsCode.includes(`lead.${field}?.toLowerCase()`), `Should search in ${field}`);
    }
  });

  it('should be case-insensitive', () => {
    assert.ok(jsCode.includes('.toLowerCase()'), 'Search should be case-insensitive');
  });
});

// ═══════════════════════════════════════════════════════════
// 6. REAL-TIME FUNCTIONALITY
// ═══════════════════════════════════════════════════════════
describe('JavaScript - Real-time Subscription', () => {
  it('should subscribe to leads table changes', () => {
    assert.ok(jsCode.includes("'leads-changes'"), 'Should subscribe to leads-changes channel');
    assert.ok(jsCode.includes("'postgres_changes'"), 'Should listen for postgres_changes');
    assert.ok(jsCode.includes("table: 'leads'"), 'Should listen on leads table');
  });

  it('should listen for all event types', () => {
    assert.ok(jsCode.includes("event: '*'"), 'Should listen for all events (INSERT, UPDATE, DELETE)');
  });

  it('should debounce real-time updates', () => {
    assert.ok(jsCode.includes('realtimeDebounceTimer'), 'Should have debounce timer variable');
    assert.ok(jsCode.includes('debouncedLoadLeads'), 'Should have debounced load function');
    assert.ok(jsCode.includes('clearTimeout(realtimeDebounceTimer)'), 'Should clear previous timer');
    assert.ok(jsCode.includes('setTimeout(() => loadLeads(), 300)'), 'Should debounce with 300ms delay');
  });
});

// ═══════════════════════════════════════════════════════════
// 7. SECURITY TESTS
// ═══════════════════════════════════════════════════════════
describe('Security', () => {
  it('should escape HTML in all user-displayed content', () => {
    // Count escapeHtml usages in renderLeads
    const renderSection = jsCode.substring(
      jsCode.indexOf('function renderLeads'),
      jsCode.indexOf('function updateStats')
    );
    const escapeCount = (renderSection.match(/escapeHtml/g) || []).length;
    assert.ok(escapeCount >= 4, `Should use escapeHtml in render (found ${escapeCount} uses, expected >= 4)`);
  });

  it('should use escapeJsString for inline onclick handlers', () => {
    const renderSection = jsCode.substring(
      jsCode.indexOf('function renderLeads'),
      jsCode.indexOf('function updateStats')
    );
    const escapeJsCount = (renderSection.match(/escapeJsString/g) || []).length;
    assert.ok(escapeJsCount >= 3, `Should use escapeJsString in onclick handlers (found ${escapeJsCount}, expected >= 3)`);
  });

  it('should use textContent (not innerHTML) for toast messages', () => {
    assert.ok(jsCode.includes('toastMessage.textContent = message'), 'Toast should use textContent, not innerHTML');
  });

  it('should use textContent for delete modal buyer name', () => {
    assert.ok(
      jsCode.includes("deleteBuyerName').textContent"),
      'Delete modal should use textContent for buyer name'
    );
  });

  it('should not use innerHTML with raw user data', () => {
    // Check that innerHTML is only used with escaped data or static templates
    const innerHTMLUsages = jsCode.match(/\.innerHTML\s*=/g) || [];
    // There should be exactly one innerHTML usage (in renderLeads for the template)
    assert.ok(
      innerHTMLUsages.length <= 2,
      `Found ${innerHTMLUsages.length} innerHTML assignments - verify all use escaped data`
    );
  });

  it('should check for Supabase client before operations', () => {
    // All async functions should check supabaseClient
    assert.ok(jsCode.includes("if (!supabaseClient)"), 'Should guard against null Supabase client');
    const guardCount = (jsCode.match(/if\s*\(!supabaseClient\)/g) || []).length;
    assert.ok(guardCount >= 3, `Should have Supabase null checks in multiple places (found ${guardCount})`);
  });

  it('should have error handling with try-catch in async functions', () => {
    const tryCatchCount = (jsCode.match(/try\s*{/g) || []).length;
    assert.ok(tryCatchCount >= 4, `Should have try-catch blocks (found ${tryCatchCount})`);
  });

  it('should not expose sensitive configuration beyond publishable key', () => {
    // Supabase anon/publishable keys are designed to be public - this is expected
    // But check there's no service_role key or other secrets
    assert.ok(!jsCode.includes('service_role'), 'Should not contain service_role key');
    assert.ok(!jsCode.includes('secret'), 'Should not contain explicit secret keys');
    // The publishable key is fine - it's designed to be in client-side code
    assert.ok(jsCode.includes('sb_publishable'), 'Should only use publishable key (expected)');
  });
});

// ═══════════════════════════════════════════════════════════
// 8. ERROR HANDLING TESTS
// ═══════════════════════════════════════════════════════════
describe('Error Handling', () => {
  it('should handle Supabase library load failure', () => {
    assert.ok(jsCode.includes("window.supabase && typeof window.supabase.createClient === 'function'"),
      'Should check if Supabase library loaded');
    assert.ok(jsCode.includes("'Supabase library failed to load from CDN'"),
      'Should log error if Supabase fails to load');
  });

  it('should show user-friendly error messages', () => {
    assert.ok(jsCode.includes('Failed to load leads'), 'Should show load failure message');
    assert.ok(jsCode.includes('Failed to add lead'), 'Should show add failure message');
    assert.ok(jsCode.includes('Failed to update status'), 'Should show update failure message');
    assert.ok(jsCode.includes('Failed to delete lead'), 'Should show delete failure message');
  });

  it('should handle case where lead is not found during status update', () => {
    assert.ok(jsCode.includes("'Lead not found"), 'Should handle missing lead during status update');
  });

  it('should handle database not connected state', () => {
    const dbNotConnected = (jsCode.match(/Database not connected/g) || []).length;
    assert.ok(dbNotConnected >= 2, `Should warn about DB not connected (found ${dbNotConnected})`);
  });

  it('should show connection failure on initial load', () => {
    assert.ok(jsCode.includes("'Database connection failed"), 'Should show connection failure toast on init');
  });

  it('should re-enable form button in finally block', () => {
    assert.ok(jsCode.includes('finally {'), 'Should use finally for cleanup');
    // Check that disabled is reset in finally
    const finallyBlock = jsCode.substring(
      jsCode.indexOf('finally {', jsCode.indexOf("'submit'")),
      jsCode.indexOf('}', jsCode.indexOf('finally {', jsCode.indexOf("'submit'")) + 100)
    );
    assert.ok(finallyBlock.includes('submitBtn.disabled = false'), 'Should re-enable button in finally');
  });
});

// ═══════════════════════════════════════════════════════════
// 9. UI/UX BEHAVIOR TESTS
// ═══════════════════════════════════════════════════════════
describe('UI/UX Behavior', () => {
  it('should toggle form visibility on button click', () => {
    assert.ok(jsCode.includes("toggleFormBtn"), 'Should have toggle form button');
    assert.ok(jsCode.includes("form.classList.contains('hidden')"), 'Should check form visibility');
    assert.ok(jsCode.includes("form.classList.remove('hidden')"), 'Should show form');
    assert.ok(jsCode.includes("form.classList.add('hidden')"), 'Should hide form');
  });

  it('should rotate icon when form is toggled', () => {
    assert.ok(jsCode.includes("icon.style.transform = 'rotate(45deg)'"), 'Should rotate icon open');
    assert.ok(jsCode.includes("icon.style.transform = 'rotate(0deg)'"), 'Should rotate icon closed');
  });

  it('should close all status menus before opening a new one', () => {
    assert.ok(jsCode.includes("document.querySelectorAll('.status-menu.open').forEach"),
      'Should close all open menus first');
  });

  it('should close status menus when clicking outside', () => {
    assert.ok(jsCode.includes("!e.target.closest('.status-dropdown')"),
      'Should detect clicks outside status dropdown');
  });

  it('should provide instant visual feedback on status change', () => {
    // selectStatus should update badge colors immediately before DB call
    assert.ok(jsCode.includes('badge.style.backgroundColor = cfg.bg'), 'Should update badge bg immediately');
    assert.ok(jsCode.includes('badge.style.color = cfg.text'), 'Should update badge text color immediately');
  });

  it('should update local state after successful status change', () => {
    assert.ok(jsCode.includes("allLeads[index].status = newStatus"), 'Should update local state');
  });

  it('should reload leads on failure to revert visual changes', () => {
    // The updateLeadStatus catch block should call loadLeads() to revert UI
    assert.ok(jsCode.includes('Error updating status'), 'Should log status update errors');
    // After the error log, loadLeads should be called to revert visual changes
    const errorLogPos = jsCode.indexOf('Error updating status');
    const afterError = jsCode.substring(errorLogPos, errorLogPos + 200);
    assert.ok(afterError.includes('loadLeads()'), 'Should reload leads on status update failure');
  });

  it('should show "no leads" message when table is empty', () => {
    assert.ok(jsCode.includes('No leads yet'), 'Should show empty state message');
  });
});

// ═══════════════════════════════════════════════════════════
// 10. STATUS DROPDOWN TESTS
// ═══════════════════════════════════════════════════════════
describe('Status Dropdown', () => {
  it('should have toggleStatusMenu function', () => {
    assert.ok(jsCode.includes('function toggleStatusMenu(leadId)'), 'Missing toggleStatusMenu');
  });

  it('should have selectStatus function', () => {
    assert.ok(jsCode.includes('function selectStatus(leadId, newStatus, optionEl)'), 'Missing selectStatus');
  });

  it('should skip update if status is already the same', () => {
    assert.ok(jsCode.includes('currentLead.status === newStatus'), 'Should check if status already matches');
    assert.ok(jsCode.includes("'Status is already '"), 'Should inform user status is already set');
  });

  it('should render all 5 status options in dropdown', () => {
    assert.ok(jsCode.includes('Object.entries(statusConfig).map'), 'Should render all statuses from config');
  });

  it('should mark current status as active in dropdown', () => {
    assert.ok(jsCode.includes("lead.status === key ? 'active' : ''"), 'Should mark active status');
  });

  it('should show checkmark for current status', () => {
    // SVG checkmark for active status
    assert.ok(jsCode.includes("lead.status === key ? '<svg"), 'Should show checkmark for active status');
  });
});

// ═══════════════════════════════════════════════════════════
// 11. VERCEL DEPLOYMENT CONFIG TESTS
// ═══════════════════════════════════════════════════════════
describe('Vercel Deployment Configuration', () => {
  const vercelConfigPath = path.join(__dirname, '..', 'vercel.json');
  let vercelConfig;

  it('should have a vercel.json file', () => {
    assert.ok(fs.existsSync(vercelConfigPath), 'Missing vercel.json');
    vercelConfig = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf-8'));
  });

  it('should have empty build command (static site)', () => {
    assert.equal(vercelConfig.buildCommand, '', 'Build command should be empty');
  });

  it('should output from root directory', () => {
    assert.equal(vercelConfig.outputDirectory, '.', 'Should output from root');
  });

  it('should have no framework set', () => {
    assert.equal(vercelConfig.framework, null, 'Framework should be null');
  });

  it('should have SPA rewrite rule', () => {
    assert.ok(vercelConfig.rewrites, 'Missing rewrites');
    const spaRewrite = vercelConfig.rewrites.find(r => r.destination === '/index.html');
    assert.ok(spaRewrite, 'Missing SPA rewrite to index.html');
  });

  it('should have cache-control headers to prevent stale content', () => {
    assert.ok(vercelConfig.headers, 'Missing headers');
    const cacheHeader = vercelConfig.headers[0]?.headers?.find(h => h.key === 'Cache-Control');
    assert.ok(cacheHeader, 'Missing Cache-Control header');
    assert.ok(cacheHeader.value.includes('must-revalidate'), 'Should include must-revalidate');
  });
});

// ═══════════════════════════════════════════════════════════
// 12. CSS / STYLING TESTS
// ═══════════════════════════════════════════════════════════
describe('CSS and Styling', () => {
  it('should have custom status dropdown styles', () => {
    assert.ok(html.includes('.status-dropdown'), 'Missing status-dropdown styles');
    assert.ok(html.includes('.status-badge'), 'Missing status-badge styles');
    assert.ok(html.includes('.status-menu'), 'Missing status-menu styles');
    assert.ok(html.includes('.status-option'), 'Missing status-option styles');
  });

  it('should have hover effects on status badge', () => {
    assert.ok(html.includes('.status-badge:hover'), 'Missing status-badge hover styles');
  });

  it('should have hover effects on status options', () => {
    assert.ok(html.includes('.status-option:hover'), 'Missing status-option hover styles');
  });

  it('should have active state for selected status', () => {
    assert.ok(html.includes('.status-option.active'), 'Missing active status option style');
  });

  it('should use z-index for dropdown layering', () => {
    assert.ok(html.includes('z-index: 50'), 'Status menu should have z-index');
  });

  it('should use transitions for smooth UX', () => {
    assert.ok(html.includes('transition: all 0.2s ease'), 'Badge should have transition');
    assert.ok(html.includes('transition: background-color 0.15s'), 'Options should have transition');
  });

  it('should have responsive grid for stat cards', () => {
    assert.ok(html.includes('grid-cols-1 md:grid-cols-5'), 'Stat cards should be responsive grid');
  });

  it('should have responsive layout for form', () => {
    assert.ok(html.includes('grid-cols-1 md:grid-cols-2'), 'Form should be responsive grid');
  });
});

// ═══════════════════════════════════════════════════════════
// 13. CODE QUALITY / POTENTIAL BUGS
// ═══════════════════════════════════════════════════════════
describe('Code Quality and Potential Bugs', () => {
  it('should not have console.log left in code (only console.error/warn)', () => {
    const consoleLogCount = (jsCode.match(/console\.log\(/g) || []).length;
    assert.equal(consoleLogCount, 0, `Found ${consoleLogCount} console.log statements - should use console.error/warn instead`);
  });

  it('should initialize allLeads as empty array', () => {
    assert.ok(jsCode.includes('let allLeads = []'), 'allLeads should start as empty array');
  });

  it('should initialize deleteLeadId as null', () => {
    assert.ok(jsCode.includes('let deleteLeadId = null'), 'deleteLeadId should start as null');
  });

  it('should guard confirmDeleteLead against null ID', () => {
    assert.ok(jsCode.includes('if (!deleteLeadId) return'), 'Should guard against null delete ID');
  });

  it('should handle missing status gracefully in getStatusStyle', () => {
    assert.ok(
      jsCode.includes("statusConfig[status] || { bg: '#F3F4F6'"),
      'getStatusStyle should have fallback for unknown status'
    );
  });

  it('should handle missing status gracefully in getStatusClass', () => {
    assert.ok(
      jsCode.includes("classes[status] || 'bg-gray-100 text-gray-800'"),
      'getStatusClass should have fallback for unknown status'
    );
  });

  it('should handle null score in render', () => {
    assert.ok(jsCode.includes('lead.score || 0'), 'Should default null score to 0');
  });

  it('should handle null source in render', () => {
    assert.ok(jsCode.includes("lead.source || 'manual'"), 'Should default null source to manual');
  });

  it('should use optional chaining for search fields', () => {
    // Search fields might be null, should use ?.
    assert.ok(jsCode.includes('lead.buyer_name?.toLowerCase()'), 'Should use optional chaining in search');
    assert.ok(jsCode.includes('lead.buyer_email?.toLowerCase()'), 'Should use optional chaining in search');
  });

  it('should close delete modal after successful deletion', () => {
    // Check that closeDeleteModal is called after delete
    const deleteSection = jsCode.substring(
      jsCode.indexOf('async function confirmDeleteLead'),
      jsCode.indexOf('// ── Search')
    );
    assert.ok(deleteSection.includes('closeDeleteModal()'), 'Should close modal after delete');
  });

  it('should load leads after successful deletion', () => {
    const deleteSection = jsCode.substring(
      jsCode.indexOf('async function confirmDeleteLead'),
      jsCode.indexOf('// ── Search')
    );
    assert.ok(deleteSection.includes('loadLeads()'), 'Should reload leads after delete');
  });

  it('should prevent default on form toggle button', () => {
    assert.ok(jsCode.includes('e.preventDefault()'), 'Should prevent default on toggle button');
  });

  it('should prevent default on form submission', () => {
    const formHandler = jsCode.substring(
      jsCode.indexOf("'submit'"),
      jsCode.indexOf("'submit'") + 200
    );
    assert.ok(formHandler.includes('e.preventDefault()'), 'Should prevent default on form submit');
  });

  it('should trim buyer name before inserting', () => {
    assert.ok(jsCode.includes("buyerName').value.trim()"), 'Should trim buyer name');
  });

  it('should handle empty optional fields with null', () => {
    assert.ok(jsCode.includes(".value.trim() || null"), 'Should convert empty strings to null');
  });

  it('should update stats from allLeads (not filtered leads)', () => {
    // In applyCurrentView, stats should always reflect all leads (not filtered)
    const applyStart = jsCode.indexOf('function applyCurrentView');
    const applySection = jsCode.substring(applyStart, applyStart + 800);
    assert.ok(applySection.includes('updateStats(allLeads)'), 'Stats should always show all leads, not filtered');
  });

  it('should not have any TODO or FIXME comments left', () => {
    const todoCount = (jsCode.match(/TODO|FIXME|HACK|XXX/gi) || []).length;
    assert.equal(todoCount, 0, `Found ${todoCount} TODO/FIXME comments`);
  });
});

// ═══════════════════════════════════════════════════════════
// 14. ACCESSIBILITY TESTS
// ═══════════════════════════════════════════════════════════
describe('Accessibility', () => {
  it('should have labels for all form inputs', () => {
    const labels = html.match(/<label[^>]*>/g) || [];
    assert.ok(labels.length >= 5, `Should have labels for form fields (found ${labels.length})`);
  });

  it('should have placeholder text on inputs', () => {
    assert.ok(html.includes('placeholder="John Smith"'), 'Name field should have placeholder');
    assert.ok(html.includes('placeholder="john@example.com"'), 'Email field should have placeholder');
    assert.ok(html.includes('placeholder="Search leads..."'), 'Search field should have placeholder');
  });

  it('should use semantic HTML elements', () => {
    assert.ok(html.includes('<header'), 'Should use semantic header');
    assert.ok(html.includes('<main'), 'Should use semantic main');
    assert.ok(html.includes('<footer'), 'Should use semantic footer');
    assert.ok(html.includes('<table'), 'Should use table for tabular data');
    assert.ok(html.includes('<thead'), 'Should use thead');
    assert.ok(html.includes('<tbody'), 'Should use tbody');
  });

  it('should have table header cells with proper element', () => {
    assert.ok(html.includes('<th'), 'Should use th for table headers');
  });
});

// ═══════════════════════════════════════════════════════════
// 15. INITIALIZATION & LIFECYCLE
// ═══════════════════════════════════════════════════════════
describe('Initialization & Lifecycle', () => {
  it('should attempt Supabase initialization in a try-catch', () => {
    assert.ok(jsCode.includes("try {\n            if (window.supabase"), 'Should wrap init in try-catch');
  });

  it('should call loadLeads on initialization', () => {
    assert.ok(jsCode.includes("if (supabaseClient) {\n            loadLeads()"), 'Should load leads on init');
  });

  it('should show error toast if Supabase not available on init', () => {
    assert.ok(jsCode.includes("} else {\n            showToast('Database connection failed"),
      'Should show error if Supabase not connected on init');
  });

  it('should only set up realtime if Supabase is connected', () => {
    // The realtime subscription should be guarded
    assert.ok(
      jsCode.includes("if (supabaseClient) {\n            supabaseClient\n                .channel"),
      'Realtime subscription should be guarded by client check'
    );
  });
});

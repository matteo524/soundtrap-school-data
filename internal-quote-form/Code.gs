/**
 * ============================================================
 *  Soundtrap for Education — Quote Request: Apps Script
 * ============================================================
 *
 *  SETUP (one-time):
 *  1. In Google Sheets: create a new spreadsheet named
 *     "Soundtrap Quote Submissions".
 *  2. Open Extensions → Apps Script, paste this file, save.
 *  3. Run initSheets() once manually to create the two sheets
 *     (Submissions + Counter) with headers.
 *  4. Internal-quote-template.html is already in this Apps Script project —
 *     no Drive upload needed.
 *  5. Update PRICING to match your actual pricing sheet.
 *  6. Deploy → New deployment → Web app:
 *       Execute as: Me
 *       Who has access: Anyone within Soundtrap (Google Workspace)
 *  7. Copy the deployment URL into PQF_CONFIG.appsScriptUrl
 *     in quote-form.html.
 *
 *  SHEETS:
 *  ┌─────────────────┬──────────────────────────────────────┐
 *  │ "Submissions"   │ One row per quote request            │
 *  │ "Counter"       │ A1 = last used quote number (int)    │
 *  └─────────────────┴──────────────────────────────────────┘
 * ============================================================
 */

// ── Column order for the Submissions sheet ──────────────────
var COLUMNS = [
  'Quote Number',
  'Timestamp',
  'Quote Type',
  // Location
  'Country',
  'State',
  'City',
  'School District',
  'School Name',
  'NCES Number',
  'Manual Entry',
  'District Enrollment',
  // Contact
  'First Name',
  'Last Name',
  'Email',
  'Your Role',
  'Soundtrap Account ID',
  // Quote details
  'Plan',
  'Number of Seats',
  'Current Plan',
  'Current Seats',
  'Additional Seats',
  'Subscription End Date',
  'Number of Schools',
  'Subscription Length',
  // Rep
  'Territory',
  'Account Manager',
  'Account Manager Email',
  // Extra
  'Use Case',
  'School Website',
  'PD Session',
  'Purchase Date',
  // Discounts
  'Sub Discount Type',
  'Sub Discount Value',
  'Maint Discount Type',
  'Maint Discount Value',
  'PD Discount Type',
  'PD Discount Value',
  'Total Discounted Cost',
  // Salesforce sync
  'SF Status',
  'SF Record ID',
  // School address (NCES-sourced, editable on the form) — appended at the end so
  // existing Sheet columns keep their positions.
  'School Address',
  'School ZIP',
];

// Maps incoming field names → column headers above
var FIELD_MAP = {
  quote_type:             'Quote Type',
  country:                'Country',
  state:                  'State',
  city:                   'City',
  school_district:        'School District',
  school_name:            'School Name',
  nces_number:            'NCES Number',
  manual_entry:           'Manual Entry',
  district_enrollment:    'District Enrollment',
  firstname:              'First Name',
  lastname:               'Last Name',
  email:                  'Email',
  your_role:              'Your Role',
  soundtrap_account_id:   'Soundtrap Account ID',
  plan:                   'Plan',
  number_of_seats:        'Number of Seats',
  current_plan:           'Current Plan',
  current_seats:          'Current Seats',
  additional_seats:       'Additional Seats',
  subscription_end_date:  'Subscription End Date',
  number_of_schools:      'Number of Schools',
  subscription_length:    'Subscription Length',
  territory:              'Territory',
  account_manager:        'Account Manager',
  account_manager_email:  'Account Manager Email',
  use_case:               'Use Case',
  school_address:         'School Address',
  school_zip:             'School ZIP',
  school_website:         'School Website',
  pd_session:             'PD Session',
  purchase_date:          'Purchase Date',
  sub_discount_type:      'Sub Discount Type',
  sub_discount_value:     'Sub Discount Value',
  maint_discount_type:    'Maint Discount Type',
  maint_discount_value:   'Maint Discount Value',
  pd_discount_type:       'PD Discount Type',
  pd_discount_value:      'PD Discount Value',
  total_discounted_cost:  'Total Discounted Cost',
};

// ── Quote generation config ──────────────────────────────────

// Deployment URL — same URL as appsScriptUrl in quote-form.html.
// Used to build the PRINT link in customer emails. Leave empty to disable.
var DEPLOYMENT_URL = 'https://script.google.com/a/macros/soundtrap.com/s/AKfycbxptbB_caLVfRwhJ0hvIJHi6MeT7WxSyfozFmlPfWQrDUxG7wGje1Om5WjNXCAC4S8yjQ/exec';

// ── Shared config (single source of truth) ───────────────────
// JSON on GitHub Pages — see /config/README.md in the repo.
var CONFIG_URL              = 'https://matteo524.github.io/soundtrap-school-data/config/config.json';
var CONFIG_CACHE_KEY        = 'SHARED_CONFIG_v1';
var CONFIG_CACHE_TTL_SECONDS = 600;  // 10 minutes

// In-memory cache for the current invocation (avoid re-parsing within one request).
var _configMemo = null;

/**
 * Loads the shared config from GitHub Pages. Cached in:
 *   1. _configMemo — for the current invocation (fastest)
 *   2. CacheService.getScriptCache() — for ~10 min across invocations
 *   3. Network fetch from CONFIG_URL — only on cold cache
 * Throws if the config can't be loaded — callers should treat this as fatal
 * (pricing/territory/etc. can't be computed without it).
 */
function loadConfig_() {
  if (_configMemo) return _configMemo;

  // Try the script-wide cache (persists across invocations within TTL)
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get(CONFIG_CACHE_KEY);
    if (cached) {
      _configMemo = JSON.parse(cached);
      return _configMemo;
    }
  } catch (_e) { /* CacheService may fail in some contexts — fall through */ }

  // Cold cache — fetch fresh
  var resp = UrlFetchApp.fetch(CONFIG_URL, {
    muteHttpExceptions: true,
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Failed to load shared config from ' + CONFIG_URL + ' — HTTP ' + resp.getResponseCode());
  }
  var text = resp.getContentText();
  _configMemo = JSON.parse(text);

  // Store in ScriptCache for the next invocation
  try {
    CacheService.getScriptCache().put(CONFIG_CACHE_KEY, text, CONFIG_CACHE_TTL_SECONDS);
  } catch (_e) { /* best-effort */ }

  return _configMemo;
}

// ── Salesforce integration config ───────────────────────────
// Store credentials via Apps Script editor:
//   Project Settings → Script Properties → Add:
//     SF_CLIENT_ID     = your Consumer Key
//     SF_CLIENT_SECRET = your Consumer Secret
var SF_INSTANCE_URL  = 'https://soundtrap.my.salesforce.com';
var SF_API_VERSION   = 'v59.0';
// Email to notify on Salesforce sync failure.
var SF_ALERT_EMAIL   = 'matteo@soundtrap.com';

// ════════════════════════════════════════════════════════════
//  ENTRY POINTS
// ════════════════════════════════════════════════════════════

// ── Main entry point ─────────────────────────────────────────
function doPost(e) {
  var result = { success: false };

  try {
    // Parse payload — supports both JSON body and form-encoded
    var data = {};
    try {
      data = JSON.parse(e.postData.contents);
    } catch (_) {
      data = e.parameter || {};
    }

    var ss          = SpreadsheetApp.getActiveSpreadsheet();
    var sheet       = ss.getSheetByName('Submissions');
    var quoteNumber = generateQuoteNumber_();
    var timestamp   = new Date();

    // Build row in COLUMNS order
    var colIndex = buildColIndex_();

    var row = new Array(COLUMNS.length).fill('');
    row[colIndex['Quote Number']] = quoteNumber;
    row[colIndex['Timestamp']]    = Utilities.formatDate(
      timestamp,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd HH:mm:ss'
    );

    Object.keys(data).forEach(function (key) {
      var col = FIELD_MAP[key];
      if (col && colIndex[col] !== undefined) {
        row[colIndex[col]] = data[key] || '';
      }
    });

    sheet.appendRow(row);
    var sheetRow = sheet.getLastRow(); // row number for SF status update

    result.success     = true;
    result.quoteNumber = quoteNumber;

    // Generate and email the quote (non-fatal — row is already saved)
    try {
      generateAndSendQuote_(data, quoteNumber, timestamp);
    } catch (emailErr) {
      result.emailError = emailErr.message;
    }

    // Push to Salesforce (non-fatal — sheet row is already saved)
    try {
      var sfResult = createSalesforceQuote_(data, quoteNumber, timestamp);
      sheet.getRange(sheetRow, colIndex['SF Status']   + 1).setValue('Created');
      sheet.getRange(sheetRow, colIndex['SF Record ID'] + 1).setValue(sfResult.id);
      result.sfRecordId = sfResult.id;
    } catch (sfErr) {
      sheet.getRange(sheetRow, colIndex['SF Status'] + 1).setValue('Failed: ' + sfErr.message);
      result.sfError = sfErr.message;
      try {
        sendSFErrorAlert_(quoteNumber, (data.firstname || '') + ' ' + (data.lastname || ''), sfErr.message);
      } catch (_) { /* alert failure is silent */ }
    }

    // Slack notification — non-fatal. Includes SF record URL when available.
    try {
      sendSlackNotification_(data, quoteNumber, timestamp, result.sfRecordId);
    } catch (_slackErr) { /* best-effort */ }

  } catch (err) {
    result.error = err.message;
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Called via google.script.run from the HtmlService form.
 * Identical logic to doPost but accepts a plain JS object directly.
 */
function submitQuote(data) {
  var result = { success: false };

  try {
    var ss          = SpreadsheetApp.getActiveSpreadsheet();
    var sheet       = ss.getSheetByName('Submissions');
    var quoteNumber = generateQuoteNumber_();
    var timestamp   = new Date();

    var colIndex = buildColIndex_();
    var row = new Array(COLUMNS.length).fill('');
    row[colIndex['Quote Number']] = quoteNumber;
    row[colIndex['Timestamp']]    = Utilities.formatDate(
      timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'
    );

    Object.keys(data).forEach(function (key) {
      var col = FIELD_MAP[key];
      if (col && colIndex[col] !== undefined) row[colIndex[col]] = data[key] || '';
    });

    sheet.appendRow(row);
    var sheetRow = sheet.getLastRow();

    result.success     = true;
    result.quoteNumber = quoteNumber;

    try {
      generateAndSendQuote_(data, quoteNumber, timestamp);
    } catch (emailErr) {
      result.emailError = emailErr.message;
    }

    try {
      var sfResult = createSalesforceQuote_(data, quoteNumber, timestamp);
      sheet.getRange(sheetRow, colIndex['SF Status']    + 1).setValue('Created');
      sheet.getRange(sheetRow, colIndex['SF Record ID'] + 1).setValue(sfResult.id);
      result.sfRecordId = sfResult.id;
    } catch (sfErr) {
      sheet.getRange(sheetRow, colIndex['SF Status'] + 1).setValue('Failed: ' + sfErr.message);
      result.sfError = sfErr.message;
      try {
        sendSFErrorAlert_(quoteNumber, (data.firstname || '') + ' ' + (data.lastname || ''), sfErr.message);
      } catch (_) {}
    }

    // Slack notification — non-fatal. Includes SF record URL when available.
    try {
      sendSlackNotification_(data, quoteNumber, timestamp, result.sfRecordId);
    } catch (_slackErr) { /* best-effort */ }

  } catch (err) {
    result.error = err.message;
  }

  return result;
}

// ── HtmlService entry point ────────────────────────────────────
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || '';
  var q    = (e && e.parameter && e.parameter.q)    || '';

  // Thank-you page
  if (page === 'thank-you') {
    return HtmlService.createHtmlOutputFromFile('thank-you')
      .setTitle('Quote Submitted — Soundtrap')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // Print / view a saved quote
  if (q) {
    var ss     = SpreadsheetApp.getActiveSpreadsheet();
    var sheet  = ss.getSheetByName('Submissions');
    var values = sheet.getDataRange().getValues();
    var colIdx = buildColIndex_();
    var colToField = {};
    Object.keys(FIELD_MAP).forEach(function(field) { colToField[FIELD_MAP[field]] = field; });

    var row = null;
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][colIdx['Quote Number']]) === String(q)) { row = values[i]; break; }
    }

    if (!row) {
      return HtmlService
        .createHtmlOutput('<p style="font-family:sans-serif;padding:40px;color:#555;">Quote <strong>' + escapeHtml_(q) + '</strong> not found.</p>')
        .setTitle('Quote Not Found');
    }

    var data = {};
    COLUMNS.forEach(function(col, i) {
      var field = colToField[col];
      if (field) data[field] = String(row[i] || '');
    });

    var quoteNumber = String(row[colIdx['Quote Number']]);
    var timestamp   = new Date(String(row[colIdx['Timestamp']]));
    var region      = regionForCountry_(data.country || '');
    var currency    = currencyForCountry_(data.country || '');
    var quoteType   = normaliseQuoteType_(data.quote_type);

    var page = buildTemplateQuote_(data, quoteNumber, timestamp, region, currency, quoteType);
    return HtmlService.createHtmlOutput(page).setTitle('Quote ' + quoteNumber);
  }

  // Default: serve the form, injecting any prefill data passed as URL params
  var prefill = {};
  var prefillKeys = ['firstname','lastname','email','role','country','state','city',
    'district','school','quote_type','plan','seats','schools','months',
    'current_plan','current_seats','end_date','use_case','website','purchase_date',
    'account_id','pd_session'];
  if (e && e.parameter) {
    prefillKeys.forEach(function(k) {
      if (e.parameter[k]) prefill[k] = e.parameter[k];
    });
  }
  var formHtml = HtmlService.createHtmlOutputFromFile('internal-quote-form').getContent();
  formHtml = formHtml.replace('</head>',
    '<script>var PREFILL_DATA=' + JSON.stringify(prefill) + ';<\/script></head>'
  );
  return HtmlService.createHtmlOutput(formHtml)
    .setTitle('Internal Quote Form — Soundtrap')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ════════════════════════════════════════════════════════════
//  PRINT PAGE
// ════════════════════════════════════════════════════════════

/**
 * Wraps the quote HTML in a full standalone page with a print button.
 * Returned by doGet() when ?q=QUOTE_NUMBER is present.
 */
function buildPrintPage_(quoteHtml, quoteNumber) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Quote ' + escapeHtml_(quoteNumber) + '</title>' +
    '<style>' +
      'body{margin:0;padding:0;background:#F2F2F5;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;}' +
      '#print-bar{position:fixed;top:0;left:0;right:0;z-index:100;background:#271B73;padding:10px 24px;display:flex;align-items:center;justify-content:space-between;box-sizing:border-box;}' +
      '#print-bar span{color:rgba(253,253,245,0.7);font-size:12px;}' +
      '#print-btn{background:#6551FF;color:#fff;border:none;padding:8px 20px;border-radius:4px;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:0.5px;}' +
      '#print-btn:hover{background:#5441D8;}' +
      '#quote-wrap{padding-top:52px;}' +
      '@media print{#print-bar{display:none;}#quote-wrap{padding-top:0;}}' +
    '</style></head><body>' +
    '<div id="print-bar">' +
      '<span>Soundtrap for Education &mdash; ' + escapeHtml_(quoteNumber) + '</span>' +
      '<button id="print-btn" onclick="window.print()">Print this Quote</button>' +
    '</div>' +
    '<div id="quote-wrap">' + quoteHtml + '</div>' +
    '</body></html>';
}

// ════════════════════════════════════════════════════════════
//  TEMPLATE-BASED PRINT PAGE
// ════════════════════════════════════════════════════════════

/**
 * Loads Internal-quote-template.html from the Apps Script project, fills in all
 * {{placeholders}}, applies server-side region/quote-type rendering, strips
 * the client-side preview JS, and injects a print bar.
 * Returns a complete HTML string ready to pass to HtmlService.createHtmlOutput().
 */
function buildTemplateQuote_(data, quoteNumber, timestamp, region, currency, quoteType, forEmail) {
  // Load template from Apps Script project — no Drive fetch needed
  var html = HtmlService.createHtmlOutputFromFile('Internal-quote-template').getContent();

  // Fill {{placeholders}} with real values
  var map = buildPlaceholderMap_(data, quoteNumber, timestamp, region, currency);
  html = replacePlaceholders_(html, map);

  // Show correct region blocks (entity notice + payment methods + header address)
  html = applyRegion_(html, region, currency);

  // Show correct quote-type section and update badge
  html = applyQuoteType_(html, quoteType);

  // Show PD row(s) only when a PD session is on the quote
  var hasPd = !!((data.pd_session || '').trim());
  html = setDisplayOnDataAttr_(html, 'data-pd-row', 'active', hasPd);

  // Show Maintenance row(s) only for District plan
  var hasMaint = ((data.plan || '').trim().toLowerCase() === 'district') &&
                 (parseInt(data.number_of_schools || 0) > 0);
  html = setDisplayOnDataAttr_(html, 'data-maint-row', 'active', hasMaint);

  // Strip client-side preview JS — page is fully server-rendered
  html = stripPreviewScript_(html);

  if (forEmail) {
    // Email: inject intro block at the top of the body (no print bar)
    var customerName = ((data.firstname || '') + ' ' + (data.lastname || '')).trim() || 'there';
    html = html.replace('<body>', '<body>' + buildEmailIntro_(customerName, region));
  } else {
    // Web/print view: inject fixed print bar (not suitable for email clients)
    html = html.replace('</head>',
      '<style>' +
      '#qt-print-bar{position:fixed;top:0;left:0;right:0;z-index:100;background:#271B73;' +
      'padding:10px 24px;display:flex;align-items:center;justify-content:space-between;' +
      'box-sizing:border-box;}' +
      '#qt-print-bar span{color:rgba(253,253,245,0.7);font-size:12px;}' +
      '#qt-print-btn{background:#6551FF;color:#fff;border:none;padding:8px 20px;' +
      'border-radius:4px;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:0.5px;}' +
      '#qt-print-btn:hover{background:#5441D8;}' +
      'body{padding-top:52px !important;}' +
      '@media print{#qt-print-bar{display:none !important;}body{padding-top:32px !important;}}' +
      '</style></head>'
    );
    html = html.replace('<body>',
      '<body><div id="qt-print-bar">' +
      '<span>Soundtrap for Education &mdash; ' + escapeHtml_(quoteNumber) + '</span>' +
      '<button id="qt-print-btn" onclick="window.print()">&#9113;&nbsp; Print this Quote</button>' +
      '</div>'
    );
  }

  return html;
}

// ════════════════════════════════════════════════════════════
//  QUOTE GENERATION
// ════════════════════════════════════════════════════════════

/**
 * Orchestrator: build the filled-in quote email and send it.
 */
function generateAndSendQuote_(data, quoteNumber, timestamp) {
  // Uses buildFullQuoteEmail_() (programmatic, inline-styled, Gmail-safe) rather than
  // the template — the template's <style>-block CSS doesn't survive Gmail's renderer.
  // The template is still used for the web/print view via doGet (?q=...).
  var region    = regionForCountry_(data.country || '');
  var currency  = currencyForCountry_(data.country || '');
  var quoteType = normaliseQuoteType_(data.quote_type);
  var printUrl  = DEPLOYMENT_URL ? DEPLOYMENT_URL + '?q=' + encodeURIComponent(quoteNumber) : '';
  var emailHtml = buildFullQuoteEmail_(data, quoteNumber, timestamp, region, currency, quoteType, printUrl);
  sendCustomerEmail_(data, quoteNumber, emailHtml);
}

/**
 * Build the full {{Placeholder}} → value map.
 */
function buildPlaceholderMap_(data, quoteNumber, timestamp, region, currency) {
  var totalSeatsAfterAddon = (parseInt(data.current_seats || 0) + parseInt(data.additional_seats || 0)) || '';

  // Standard-price line items for the template
  var subCostObj  = calcSubscriptionCost_(data, currency);
  var pdSession   = (data.pd_session || '').trim();
  var pdCost      = calcPdCost_(pdSession);
  // Display name with "PD " stripped (e.g. "In Person PD for 3 hours" -> "In Person for 3 hours")
  var pdSessionDisplay = pdSession.replace(/\bPD\s+/g, '');

  // Maintenance fee — District plan only
  var schoolsNum  = parseInt(data.number_of_schools || 0) || 0;
  var monthsNum   = parseInt(data.subscription_length || 12) || 12;
  var planName    = (data.plan || '').trim();
  var maintCost   = 0;
  if (planName.toLowerCase() === 'district' && schoolsNum > 0) {
    try {
      var pricing = loadConfig_().pricing;
      var perSchool = pricing[currency] && pricing[currency].District && pricing[currency].District.m;
      if (perSchool) {
        maintCost = Math.round(perSchool * schoolsNum * (monthsNum / 12));
      }
    } catch (_e) { /* fall through */ }
  }

  // Discount-adjusted (net) prices — same logic as buildFullQuoteEmail_
  var subDiscType   = data.sub_discount_type   || '%';
  var subDiscVal    = parseFloat(data.sub_discount_value)   || 0;
  var maintDiscType = data.maint_discount_type || '%';
  var maintDiscVal  = parseFloat(data.maint_discount_value) || 0;
  var pdDiscType    = data.pd_discount_type    || '%';
  var pdDiscVal     = parseFloat(data.pd_discount_value)    || 0;
  var subNet   = applyDiscount_(subCostObj.value || 0, subDiscType, subDiscVal);
  var maintNet = applyDiscount_(maintCost, maintDiscType, maintDiscVal);
  var pdNet    = applyDiscount_(pdCost,    pdDiscType,    pdDiscVal);
  var totalStd = (subCostObj.value || 0) + maintCost + pdCost;
  var totalNet = subNet + maintNet + pdNet;
  var hasDiscount = (subDiscVal > 0) || (maintDiscVal > 0) || (pdDiscVal > 0);

  // GrandTotal in the template's Total row: use net total (matches what the customer pays)
  var grandTotalValue = totalNet;
  var grandTotal      = (pdCost > 0 || maintCost > 0 || hasDiscount)
                      ? fmtCurrency_(grandTotalValue, currency)
                      : subCostObj.formatted;

  // Complimentary Introductory PD line — shown when district enrollment > 1000
  var compPd = (parseInt(String(data.district_enrollment || '').replace(/[^0-9]/g, ''), 10) || 0) > 1000;

  // Build the discount block HTML — ALWAYS rendered (matches the customer email).
  // row() renders a plain list price + "—" discount when no discount is applied.
  var discountBlockHtml = buildDiscountBlockForTemplate_({
    currency:        currency,
    subStd:          subCostObj.value || 0,
    subNet:          subNet,
    subDiscType:     subDiscType,
    subDiscVal:      subDiscVal,
    maintStd:        maintCost,
    maintNet:        maintNet,
    maintDiscType:   maintDiscType,
    maintDiscVal:    maintDiscVal,
    pdStd:           pdCost,
    pdNet:           pdNet,
    pdDiscType:      pdDiscType,
    pdDiscVal:       pdDiscVal,
    pdSessionDisplay:pdSessionDisplay,
    schoolsNum:      schoolsNum,
    compPd:          compPd,
    totalStd:        totalStd,
    totalNet:        totalNet,
  });

  return {
    '{{QuoteNumber}}':           quoteNumber,
    '{{SubmissionDate}}':        formatDate_(timestamp),
    '{{ValidUntil}}':            formatDate_(addDays_(timestamp, loadConfig_().quoteValidDays)),
    '{{Currency}}':              currency,
    '{{SalesRepName}}':          data.account_manager        || '',
    '{{SalesRepEmail}}':         data.account_manager_email  || '',
    '{{CustomerFirstLastName}}': ((data.firstname || '') + ' ' + (data.lastname || '')).trim(),
    '{{CustomerRole}}':          data.your_role              || '',
    '{{SchoolName}}':            data.school_name || data.school_district || '',
    '{{State}}':                 data.state                  || '',
    '{{StateComma}}':            data.state ? ',' : '',
    '{{Country}}':               data.country                || '',
    '{{CustomerEmail}}':         data.email                  || '',
    '{{SoundtrapAccountID}}':    data.soundtrap_account_id   || 'N/A',
    '{{SoundtrapPlan}}':         data.plan                   || '',
    '{{NumberOfSeats}}':         data.number_of_seats        || '',
    '{{NumberOfSchools}}':       data.number_of_schools      || '',
    '{{SubscriptionLength}}':    formatMonths_(parseInt(data.subscription_length || 12)),
    '{{SubscriptionCost}}':      subCostObj.formatted,
    '{{TaxNote}}':               loadConfig_().taxNotes[region] || loadConfig_().taxNotes['ROW'],
    '{{SubscriptionEndDate}}':   data.subscription_end_date  || '',
    '{{RenewalEndDate}}':        calcRenewalEndDate_(data),
    '{{CurrentPlan}}':           data.current_plan           || '',
    '{{CurrentSeats}}':          data.current_seats          || '',
    '{{AdditionalSeats}}':       data.additional_seats       || '',
    '{{TotalSeatsAfterAddon}}':  totalSeatsAfterAddon        || '',
    '{{PdSession}}':             pdSessionDisplay,
    '{{PdCost}}':                pdCost > 0 ? '+ ' + fmtCurrency_(pdCost, currency) : '',
    '{{MaintenanceCost}}':       maintCost > 0 ? '+ ' + fmtCurrency_(maintCost, currency) : '',
    '{{GrandTotal}}':            grandTotal,
    '{{DiscountBlock}}':         discountBlockHtml,
    // Region content from config (single source of truth — see quoteContent)
    '{{VendorRegistrationBlock}}': renderVendorRegTemplate_(region),
    '{{PaymentMethodsBlock}}':     renderPaymentMethodsTemplate_(region),
  };
}

/**
 * Build the HTML for the "Pricing & Discounts" block shown in the
 * Salesforce-link template view. Mirrors the email's discount table but
 * styled to fit the template's design.
 * @param {object} d — pre-computed discount info (see buildPlaceholderMap_)
 * @return {string} HTML
 */
function buildDiscountBlockForTemplate_(d) {
  function row(label, std, net, type, val) {
    if (std <= 0) return '';
    var hasD = (parseFloat(val) || 0) > 0;
    var disc = std - net;
    var discCell = hasD
      ? '<td style="padding:10px 12px;text-align:right;color:#6551FF;font-size:13px;">−' + fmtCurrency_(disc, d.currency) + ' (−' + Math.round((disc / std) * 100) + '%)</td>'
      : '<td style="padding:10px 12px;text-align:right;color:rgba(22,22,22,0.4);">—</td>';
    var stdCell = hasD
      ? '<td style="padding:10px 12px;text-align:right;color:#999;text-decoration:line-through;font-size:13px;">' + fmtCurrency_(std, d.currency) + '</td>'
      : '<td style="padding:10px 12px;text-align:right;font-size:13px;">' + fmtCurrency_(std, d.currency) + '</td>';
    return '<tr>' +
      '<td style="padding:10px 12px;font-size:13px;color:#16161B;">' + label + '</td>' +
      stdCell +
      discCell +
      '<td style="padding:10px 12px;text-align:right;font-weight:700;color:#16161B;font-size:13px;">' + fmtCurrency_(net, d.currency) + '</td>' +
      '</tr>';
  }

  var rows = [];
  rows.push(row('Subscription Fee', d.subStd, d.subNet, d.subDiscType, d.subDiscVal));
  if (d.maintStd > 0) {
    var maintLabel = 'Maintenance Fee' + (d.schoolsNum > 0
      ? '<br><span style="font-size:11px;color:rgba(22,22,22,0.5);">' + d.schoolsNum + ' schools</span>'
      : '');
    rows.push(row(maintLabel, d.maintStd, d.maintNet, d.maintDiscType, d.maintDiscVal));
  }
  if (d.pdStd > 0) {
    var pdLabel = 'Professional Development' +
      '<br><span style="font-size:11px;color:rgba(22,22,22,0.5);">' + escapeHtml_(d.pdSessionDisplay) + '</span>';
    rows.push(row(pdLabel, d.pdStd, d.pdNet, d.pdDiscType, d.pdDiscVal));
  }
  if (d.compPd) {
    rows.push(
      '<tr>' +
      '<td style="padding:10px 12px;font-size:13px;color:#16161B;">Complimentary Introductory Professional Development' +
      '<br><span style="font-size:11px;color:rgba(22,22,22,0.5);">3 hours — included at no charge</span></td>' +
      '<td style="padding:10px 12px;text-align:right;font-size:13px;">' + fmtCurrency_(0, d.currency) + '</td>' +
      '<td style="padding:10px 12px;text-align:right;color:rgba(22,22,22,0.4);">—</td>' +
      '<td style="padding:10px 12px;text-align:right;font-weight:700;color:#16161B;font-size:13px;">' + fmtCurrency_(0, d.currency) + '</td>' +
      '</tr>'
    );
  }

  var totalDiscAmt = d.totalStd - d.totalNet;
  var totalDiscStr = fmtDiscountBoth_(d.totalStd, totalDiscAmt, d.currency);
  var border = 'border-top:2px solid #E5E5EA;';
  var totalRow =
    '<tr>' +
      '<td style="padding:10px 12px;font-size:12px;font-weight:700;color:#555;' + border + '">Total</td>' +
      '<td style="padding:10px 12px;text-align:right;font-size:13px;color:#999;text-decoration:line-through;' + border + '">' + fmtCurrency_(d.totalStd, d.currency) + '</td>' +
      '<td style="padding:10px 12px;text-align:right;font-size:13px;color:#6551FF;' + border + '">' + escapeHtml_(totalDiscStr) + '</td>' +
      '<td style="padding:10px 12px;text-align:right;font-size:14px;font-weight:800;color:#16161B;' + border + '">' + fmtCurrency_(d.totalNet, d.currency) + '</td>' +
    '</tr>';

  return [
    '<div style="margin-top:32px;">',
    '<div class="qt-section-title" style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#6551FF;font-weight:700;margin-bottom:16px;">Pricing &amp; Discounts</div>',
    '<table style="width:100%;border-collapse:collapse;background:#FDFDFE;border-radius:8px;overflow:hidden;">',
    '<thead style="background:#271B73;color:#FDFDFE;">',
    '<tr>',
    '<th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;width:40%;">Line Item</th>',
    '<th style="padding:10px 12px;text-align:right;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">List Price</th>',
    '<th style="padding:10px 12px;text-align:right;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Discount</th>',
    '<th style="padding:10px 12px;text-align:right;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Net Price</th>',
    '</tr></thead>',
    '<tbody>',
    rows.join(''),
    '</tbody>',
    '<tfoot>',
    totalRow,
    '</tfoot>',
    '</table>',
    '</div>',
  ].join('');
}

/**
 * Replace every {{Key}} in html with the corresponding value from map.
 */
function replacePlaceholders_(html, map) {
  Object.keys(map).forEach(function (key) {
    // Escape special regex characters in the key (curly braces)
    var escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(escaped, 'g'), map[key] !== null && map[key] !== undefined ? String(map[key]) : '');
  });
  return html;
}

/**
 * Server-side region rendering.
 *
 * The template already has style="display:none;" on inactive elements.
 * This function ensures the correct region is visible and others are hidden,
 * and fills in currency/tax-note data-placeholder spans.
 */
function applyRegion_(html, region, currency) {
  var regionKeys = ['US', 'Canada', 'ROW', 'ANZ'];

  regionKeys.forEach(function (r) {
    var isActive = (r === region);
    // data-region="X" elements (entity notices + payment blocks)
    // Match opening tags that contain data-region="r"
    html = setDisplayOnDataAttr_(html, 'data-region', r, isActive);
  });

  // Header address: data-address="US" → visible when region=US
  html = setDisplayOnDataAttr_(html, 'data-address', 'US',   region === 'US');
  html = setDisplayOnDataAttr_(html, 'data-address', 'intl', region !== 'US');

  // data-placeholder="Currency" spans
  html = html.replace(
    /(<span[^>]*data-placeholder="Currency"[^>]*>)[^<]*(<\/span>)/gi,
    '$1' + escapeHtml_(currency) + '$2'
  );

  // data-placeholder="TaxNote" spans
  var taxNote = loadConfig_().taxNotes[region] || loadConfig_().taxNotes['ROW'];
  html = html.replace(
    /(<span[^>]*data-placeholder="TaxNote"[^>]*>)[^<]*(<\/span>)/gi,
    '$1' + escapeHtml_(taxNote) + '$2'
  );

  return html;
}

// ════════════════════════════════════════════════════════════
//  REGION CONTENT — Vendor Registration + Payment Methods
//  Single source of truth: config.json → quoteContent.
//  Two renderers per block: *Template_ (CSS classes, for the web/PRINT/
//  Salesforce template) and *Email_ (inline styles, Gmail-safe).
//  Both read the SAME config strings so wording never drifts.
//  Kept in sync with public-quote-form/Code.gs.
// ════════════════════════════════════════════════════════════

function quoteContentCfg_() {
  return loadConfig_().quoteContent || { vendorRegistration: {}, paymentMethods: {} };
}
function vendorRegFor_(region) {
  var v = quoteContentCfg_().vendorRegistration || {};
  return v[region] || v['ROW'] || '';
}
function paymentMethodsFor_(region) {
  var p = quoteContentCfg_().paymentMethods || {};
  return p[region] || p['ROW'] || [];
}

/** Add brand-purple inline styling to any <a> tag that lacks an inline style (email only). */
function styleEmailLinks_(html) {
  return String(html || '').replace(/<a (?![^>]*style=)/gi, '<a style="color:#6551FF;" ');
}

/** Vendor Registration block — template (CSS-class) variant. */
function renderVendorRegTemplate_(region) {
  var icon = (region === 'US' || region === 'Canada') ? '🏢' : '🌏';
  return '<section class="qt-entity-region">' +
    '<div class="qt-entity-notice">' +
    '<div class="qt-entity-icon">' + icon + '</div>' +
    '<p><strong>Vendor Registration:</strong> ' + vendorRegFor_(region) + '</p>' +
    '</div></section>';
}

/** Payment Methods block — template (CSS-class) variant. */
function renderPaymentMethodsTemplate_(region) {
  var cards = paymentMethodsFor_(region).map(function (m) {
    var cls       = 'qt-payment-card' + (m.preferred ? ' primary' : '');
    var styleAttr = m.fullWidth ? ' style="grid-column: 1 / -1"' : '';
    var badge     = m.preferred ? ' <span class="qt-badge">Preferred</span>' : '';
    return '<div class="' + cls + '"' + styleAttr + '>' +
      '<div class="qt-payment-card-title">' + m.title + badge + '</div>' +
      '<p>' + m.body + '</p></div>';
  }).join('');
  return '<div class="qt-payment-grid two-col">' + cards + '</div>';
}

/** Vendor Registration block — email (inline-style) variant. */
function renderVendorRegEmail_(region) {
  return '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td bgcolor="#F5F3FF" style="background-color:#F5F3FF;border-radius:6px;padding:14px 16px;font-size:12px;color:#333;line-height:1.6;">' +
    '<strong>&#x1F3E2; Vendor Registration:</strong> ' + styleEmailLinks_(vendorRegFor_(region)) +
    '</td></tr></table>';
}

/** Payment Methods block — email (inline-style) variant. Cards stack vertically for client robustness. */
function renderPaymentMethodsEmail_(region) {
  var rows = paymentMethodsFor_(region).map(function (m) {
    var bg    = m.preferred ? '#EBE9FF' : '#F5F3FF';
    var badge = m.preferred
      ? ' <span style="background-color:#6551FF;color:#FDFDFE;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;letter-spacing:0.5px;">PREFERRED</span>'
      : '';
    return '<tr><td bgcolor="' + bg + '" style="background-color:' + bg + ';border-radius:6px;padding:14px 16px;font-size:12px;color:#555;line-height:1.6;">' +
      '<div style="font-size:12px;font-weight:700;color:#16161B;margin-bottom:6px;">' + m.title + badge + '</div>' +
      styleEmailLinks_(m.body) +
      '</td></tr><tr><td style="height:8px;font-size:0;line-height:0;">&nbsp;</td></tr>';
  }).join('');
  return '<table width="100%" cellpadding="0" cellspacing="0" border="0">' + rows + '</table>';
}

/**
 * Server-side quote-type rendering.
 * Shows only data-quote-type="TYPE" section; hides others.
 * Updates the badge element's text and class.
 */
function applyQuoteType_(html, quoteType) {
  var validTypes = ['NEW', 'RENEWAL', 'ADD-ON', 'UPGRADE'];
  if (validTypes.indexOf(quoteType) === -1) quoteType = 'NEW';

  validTypes.forEach(function (t) {
    html = setDisplayOnDataAttr_(html, 'data-quote-type', t, t === quoteType);
  });

  // Update badge: id="qt-type-badge" class and text
  var badgeClass = { 'NEW': '', 'RENEWAL': 'renewal', 'ADD-ON': 'addon', 'UPGRADE': 'upgrade' };
  var cls = 'qt-type-badge' + (badgeClass[quoteType] ? ' ' + badgeClass[quoteType] : '');
  html = html.replace(
    /(<span[^>]*id="qt-type-badge"[^>]*>)[^<]*(<\/span>)/i,
    '<span id="qt-type-badge" class="' + cls + '">' + quoteType + '</span>'
  );

  return html;
}

/**
 * Remove the browser-only <script>…</script> block from the template.
 * The filled-in HTML is fully static — no JS needed.
 */
function stripPreviewScript_(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '');
}

/**
 * Helper: add or remove style="display:none;" on all opening tags that
 * contain   attrName="attrValue"   (e.g. data-region="US").
 *
 * @param {string}  html      — the HTML string to modify
 * @param {string}  attrName  — attribute name, e.g. 'data-region'
 * @param {string}  attrValue — attribute value, e.g. 'US'
 * @param {boolean} visible   — true = ensure element is visible, false = hidden
 */
function setDisplayOnDataAttr_(html, attrName, attrValue, visible) {
  // Match any opening tag that contains attrName="attrValue"
  var tagRegex = new RegExp(
    '(<(?:section|div|span|header|footer|tr|td|table)[^>]*' +
    attrName.replace(/[-]/g, '\\-') + '="' + attrValue.replace(/[-]/g, '\\-') + '"[^>]*?)' +
    '(\\s*style="[^"]*")?' +
    '(>)',
    'gi'
  );

  return html.replace(tagRegex, function (match, pre, existingStyle, close) {
    if (visible) {
      // Remove any existing display:none from the style attribute
      if (!existingStyle) return pre + close;
      var cleaned = existingStyle
        .replace(/\s*display\s*:\s*none\s*;?/gi, '')
        .replace(/style="\s*"/, '')
        .trim();
      return pre + (cleaned ? ' ' + cleaned : '') + close;
    } else {
      // Ensure display:none is present
      if (existingStyle && /display\s*:\s*none/i.test(existingStyle)) {
        return match; // already hidden
      }
      return pre + ' style="display:none;"' + close;
    }
  });
}

// ════════════════════════════════════════════════════════════
//  PRICING
// ════════════════════════════════════════════════════════════

/**
 * Tiered seat-cost calculation — mirrors calcPrice() in quote-form.html.
 * Minimum billable seat count is 50.
 * Returns { seats, maintenance, total } or null if plan/currency not found.
 */
function calcPrice_(seats, plan, numSchools, currency) {
  var pricing = loadConfig_().pricing;
  var row = pricing[currency] && pricing[currency][plan];
  if (!row) return null;
  var n = Math.max(seats, 50);
  var t = row.t;
  var seatCost = Math.round(
    Math.min(n, 50)                         * t[0] +
    Math.max(Math.min(n - 50,   450),  0)   * t[1] +
    Math.max(Math.min(n - 500,  500),  0)   * t[2] +
    Math.max(Math.min(n - 1000, 4000), 0)   * t[3] +
    Math.max(Math.min(n - 5000, 5000), 0)   * t[4] +
    Math.max(Math.min(n - 10000,10000),0)   * t[5] +
    Math.max(Math.min(n - 20000,30000),0)   * t[6] +
    Math.max(Math.min(n - 50000,100000),0)  * t[7] +
    Math.max(n - 150000, 0)                 * t[8]
  );
  var maintenanceCost = (plan === 'District') ? row.m * (numSchools || 0) : 0;
  return { seats: seatCost, maintenance: maintenanceCost, total: seatCost + maintenanceCost };
}

/**
 * Multi-year price — mirrors calcMultiYearPrice() in quote-form.html.
 * Year 2 at −5%, Year 3 at −10%. Pro-rata for non-standard lengths.
 */
function calcMultiYearPrice_(baseAnnual, months) {
  if (months <= 12)  return baseAnnual;
  if (months === 24) return baseAnnual + baseAnnual * 0.95;
  if (months === 36) return baseAnnual + baseAnnual * 0.95 + baseAnnual * 0.90;
  return (baseAnnual / 12) * months; // pro-rata fallback
}

/**
 * Days between today (server time) and a date string.
 * Returns 0 if the date is in the past or invalid.
 */
function daysUntil_(dateStr) {
  if (!dateStr) return 0;
  try {
    var end   = new Date(dateStr);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((end - today) / 86400000));
  } catch (_) { return 0; }
}

/**
 * Calculate the subscription cost from form data and return a
 * formatted currency string.
 *
 * NEW / RENEWAL : full annual (or multi-year) cost
 * ADD-ON        : pro-rata incremental cost for remaining days
 * UPGRADE       : pro-rata cost difference for remaining days
 */
function calcSubscriptionCost_(data, currency) {
  var none = { value: 0, formatted: '\u2014' };
  var quoteType = normaliseQuoteType_(data.quote_type);
  var plan      = (data.plan      || '').trim();
  var seats     = parseInt(data.number_of_seats  || 0);
  var schools   = parseInt(data.number_of_schools|| 0);
  var months    = parseInt(data.subscription_length || 12);

  // ── ADD-ON ────────────────────────────────────────────────
  if (quoteType === 'ADD-ON') {
    var currentSeats = parseInt(data.current_seats    || 0);
    var addonSeats   = parseInt(data.additional_seats || 0);
    if (!currentSeats || !addonSeats || !plan) return none;
    var days = daysUntil_(data.subscription_end_date);
    if (!days) return none;
    var costCurrent = calcPrice_(currentSeats,               plan, 0, currency);
    var costNew     = calcPrice_(currentSeats + addonSeats,  plan, 0, currency);
    if (!costCurrent || !costNew) return none;
    var proRata = Math.round((costNew.total - costCurrent.total) * days / 365);
    return proRata > 0 ? { value: proRata, formatted: fmtCurrency_(proRata, currency) } : none;
  }

  // ── UPGRADE ───────────────────────────────────────────────
  if (quoteType === 'UPGRADE') {
    var currentPlan  = (data.current_plan  || '').trim();
    var currentSeats = parseInt(data.current_seats || 0);
    if (!currentPlan || !currentSeats || !plan || !seats) return none;
    var days = daysUntil_(data.subscription_end_date);
    if (!days) return none;
    var newCost     = calcPrice_(seats,        plan,        schools, currency);
    var currentCost = calcPrice_(currentSeats, currentPlan, 0,       currency);
    if (!newCost || !currentCost) return none;
    var upgradeCost = Math.round((newCost.total - currentCost.total) * days / 365);
    return upgradeCost > 0 ? { value: upgradeCost, formatted: fmtCurrency_(upgradeCost, currency) } : none;
  }

  // ── NEW / RENEWAL ─────────────────────────────────────────
  if (!plan || !seats) return none;
  var annual = calcPrice_(seats, plan, schools, currency);
  if (!annual) return none;
  var total = Math.round(calcMultiYearPrice_(annual.total, months));
  return { value: total, formatted: fmtCurrency_(total, currency) };
}

/** Return the fixed USD cost for a PD session, or 0 if none selected. */
function calcPdCost_(pdSession) {
  return loadConfig_().pdPrices[pdSession] || 0;
}

// ════════════════════════════════════════════════════════════
//  EMAIL
// ════════════════════════════════════════════════════════════

/**
 * Send the full branded quote inline as the email body (no attachment).
 */
function sendCustomerEmail_(data, quoteNumber, emailHtml) {
  var customerName = ((data.firstname || '') + ' ' + (data.lastname || '')).trim() || 'there';
  var replyTo      = data.account_manager_email || 'orders@soundtrap.com';
  var subject      = 'Your Soundtrap for Education Price Quote \u2014 ' + quoteNumber;
  var region       = regionForCountry_(data.country || '');

  GmailApp.sendEmail(
    data.email,
    subject,
    'Hi ' + customerName + ', please view this email in an HTML-capable client to see your Soundtrap price quote (' + quoteNumber + ').',
    {
      htmlBody: buildEmailIntro_(customerName, region) + emailHtml,
      name:     'Soundtrap for Education',
      replyTo:  replyTo,
    }
  );
}

/**
 * Builds the plain intro block that appears above the quote in the customer email.
 * Includes next-steps instructions and a US-only W9 link.
 */
function buildEmailIntro_(customerName, region) {
  var h = [];
  var s = 'font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif;';
  h.push('<div style="' + s + 'max-width:600px;margin:0 auto;padding:32px 24px 24px;color:#333;">');
  h.push('<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">Hello ' + escapeHtml_(customerName) + ',</p>');
  h.push('<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">Thank you for requesting a price quote for a Soundtrap for Education subscription.</p>');
  h.push('<p style="margin:0 0 12px;font-size:14px;line-height:1.6;">When you are ready to submit your order, please follow these steps:</p>');
  h.push('<ul style="margin:0 0 16px;padding-left:22px;font-size:14px;line-height:1.9;">');
  h.push('<li>Download the price quote attached to this email.</li>');
  h.push('<li><a href="https://soundtrap.me/order_form" style="color:#6551FF;">Go to the Order Submission Page</a> and fill out all the mandatory fields.</li>');
  h.push('<li>Attach the Price Quote when you submit your order.</li>');
  h.push('</ul>');
  if (region === 'US') {
    h.push('<p style="margin:0 0 16px;font-size:14px;"><a href="https://support.soundtrap.com/hc/en-us/articles/4402504684306-Where-can-I-find-the-W9-form" style="color:#6551FF;">You can access the Soundtrap W9, here.</a></p>');
  }
  h.push('<p style="margin:0 0 24px;font-size:14px;line-height:1.6;">If you have any questions, feel free to reach out to the sales representative responsible for your country \u2014 you have their contact details in the quote below.</p>');
  h.push('<p style="margin:0 0 2px;font-size:14px;">Best regards,</p>');
  h.push('<p style="margin:0 0 24px;font-size:14px;">The Soundtrap Team</p>');
  h.push('<p style="margin:0 0 32px;font-size:15px;font-weight:700;color:#6551FF;">\u2014 Soundtrap\u00ae for Education</p>');
  h.push('</div>');
  h.push('<hr style="border:none;border-top:2px solid #E5E5EA;margin:0 0 32px;">');
  return h.join('');
}

/**
 * Build a complete, email-safe HTML quote for inline rendering.
 * Uses <table> layout and fully inline styles (Gmail-compatible).
 */
function buildFullQuoteEmail_(data, quoteNumber, timestamp, region, currency, quoteType, printUrl) {
  var customerName = ((data.firstname || '') + ' ' + (data.lastname || '')).trim() || 'Valued Customer';
  var repName      = data.account_manager       || '';
  var repEmail     = data.account_manager_email || 'orders@soundtrap.com';
  var schoolName   = data.school_name || data.school_district || '';
  var stateCountry = [data.state, data.country].filter(Boolean).join(', ');
  var accountId    = data.soundtrap_account_id || 'N/A';
  var plan         = data.plan             || '\u2014';
  var seats        = data.number_of_seats  || '\u2014';
  var months       = formatMonths_(parseInt(data.subscription_length || 12));
  var monthsNum    = parseInt(data.subscription_length || 12);
  var schoolsNum   = parseInt(data.number_of_schools || 0);
  var seatsNum     = parseInt(data.number_of_seats   || 0);
  var pdSession    = (data.pd_session || '').trim();
  var pdCost       = calcPdCost_(pdSession);

  // \u2500\u2500 Compute standard line-item fees \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  var subFeeStd   = 0;
  var maintFeeStd = 0;
  var quoteTypeN  = normaliseQuoteType_(data.quote_type);
  if (quoteTypeN === 'NEW' || quoteTypeN === 'RENEWAL') {
    var annualPricing = calcPrice_(seatsNum, data.plan || '', schoolsNum, currency);
    if (annualPricing) {
      subFeeStd   = Math.round(calcMultiYearPrice_(annualPricing.seats, monthsNum));
      maintFeeStd = Math.round(annualPricing.maintenance * (monthsNum / 12));
    }
  } else {
    var costObj2 = calcSubscriptionCost_(data, currency);
    subFeeStd = costObj2 ? costObj2.value : 0;
  }
  var totalStd = subFeeStd + maintFeeStd + pdCost;

  // \u2500\u2500 Apply discounts \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  var subDiscType  = data.sub_discount_type  || '%';
  var subDiscVal   = data.sub_discount_value  || '0';
  var maintDiscType = data.maint_discount_type || '%';
  var maintDiscVal = data.maint_discount_value || '0';
  var pdDiscType   = data.pd_discount_type   || '%';
  var pdDiscVal    = data.pd_discount_value   || '0';

  var subFeeNet   = applyDiscount_(subFeeStd,   subDiscType,  subDiscVal);
  var maintFeeNet = applyDiscount_(maintFeeStd, maintDiscType, maintDiscVal);
  var pdFeeNet    = applyDiscount_(pdCost,      pdDiscType,   pdDiscVal);
  var totalNet    = subFeeNet + maintFeeNet + pdFeeNet;

  var cost      = fmtCurrency_(totalNet || totalStd, totalNet !== totalStd ? 'USD' : currency);
  var grandTotal = cost;
  var submDate     = formatDate_(timestamp);
  var validUntil   = formatDate_(addDays_(timestamp, loadConfig_().quoteValidDays));
  var taxNote      = loadConfig_().taxNotes[region] || loadConfig_().taxNotes['ROW'];
  var endDate      = formatDateStr_(data.subscription_end_date);
  var renewalEnd   = calcRenewalEndDate_(data)  || '\u2014';
  var currentPlan  = data.current_plan    || '\u2014';
  var currentSeats = data.current_seats   || '\u2014';
  var addlSeats    = data.additional_seats|| '\u2014';
  var totalSeats   = (parseInt(data.current_seats || 0) + parseInt(data.additional_seats || 0)) || '\u2014';

  var companyAddr = region === 'US'
    ? '<strong style="display:block;color:#FDFDFE;font-size:12px;margin-bottom:2px;">Soundtrap US Inc.</strong>150 N. Michigan Ave., Suite 1950<br>Chicago, IL 60601'
    : '<strong style="display:block;color:#FDFDFE;font-size:12px;margin-bottom:2px;">Soundtrap AB</strong>Repslagargatan 17A<br>118 46 Stockholm';

  var badgeBg = quoteType === 'RENEWAL' ? '#4A3BBF' : '#6551FF';

  var h = [];

  // ── Outer wrapper ────────────────────────────────────────────
  h.push('<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F2F2F5" style="background-color:#F2F2F5;"><tr><td align="center" style="padding:24px 16px;">');
  h.push('<table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FDFDFE" style="background-color:#FDFDFE;max-width:600px;width:100%;">');

  // ── Purple accent bar ────────────────────────────────────────
  h.push('<tr><td height="4" bgcolor="#6551FF" style="background-color:#6551FF;font-size:0;line-height:0;">&nbsp;</td></tr>');

  // ── Header ──────────────────────────────────────────────────
  h.push('<tr><td bgcolor="#16161B" style="background-color:#16161B;padding:28px 36px;">');
  h.push('<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>');
  h.push('<td style="vertical-align:bottom;">');
  h.push('<div style="font-family:\'Arial Black\',\'Arial Bold\',Arial,sans-serif;font-size:26px;font-weight:900;color:#FDFDFE;margin-bottom:4px;">Soundtrap</div>');
  h.push('<div style="font-size:11px;color:rgba(253,253,245,0.55);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:16px;">for Education</div>');
  h.push('<div style="font-size:18px;font-weight:700;color:#FDFDFE;letter-spacing:1px;">PRICE QUOTE</div>');
  h.push('</td>');
  h.push('<td style="text-align:right;vertical-align:top;font-size:11px;line-height:1.7;color:rgba(253,253,245,0.65);">');
  if (printUrl) {
    h.push('<div style="margin-bottom:10px;">');
    h.push('<a href="' + printUrl + '" target="_blank" style="display:inline-block;background-color:rgba(255,255,255,0.12);color:#FDFDFE;font-size:10px;font-weight:700;letter-spacing:0.8px;padding:6px 12px;border-radius:4px;text-decoration:none;border:1px solid rgba(255,255,255,0.28);">&#9113;&nbsp;PRINT</a>');
    h.push('</div>');
  }
  h.push(companyAddr);
  h.push('</td>');
  h.push('</tr></table></td></tr>');

  // ── Meta bar ─────────────────────────────────────────────────
  h.push('<tr><td bgcolor="#271B73" style="background-color:#271B73;padding:14px 36px;">');
  h.push('<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>');
  function metaCell(label, value, align) {
    return '<td style="vertical-align:top;' + (align ? 'text-align:' + align + ';' : '') + '">' +
      '<div style="font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(253,253,245,0.55);margin-bottom:4px;">' + label + '</div>' +
      '<div style="font-size:12px;color:#FDFDFE;">' + value + '</div></td>';
  }
  h.push(metaCell('Quote Number', '<span style="font-family:monospace;">' + escapeHtml_(quoteNumber) + '</span>'));
  h.push(metaCell('Date', escapeHtml_(submDate)));
  h.push(metaCell('Valid Until', escapeHtml_(validUntil)));
  h.push('<td style="vertical-align:top;text-align:right;">');
  h.push('<div style="font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(253,253,245,0.55);margin-bottom:6px;">Quote Type</div>');
  h.push('<span style="display:inline-block;background-color:' + badgeBg + ';color:#FDFDFE;font-size:10px;font-weight:700;letter-spacing:1px;padding:4px 10px;border-radius:4px;">' + escapeHtml_(quoteType) + '</span>');
  h.push('</td>');
  h.push('</tr></table></td></tr>');

  // ── Parties ──────────────────────────────────────────────────
  h.push('<tr><td style="padding:24px 36px 16px;">');
  h.push('<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>');
  h.push('<td width="49%" style="vertical-align:top;">');
  h.push('<div style="font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6551FF;margin-bottom:8px;">From &mdash; Sales Representative</div>');
  if (repName) h.push('<div style="font-size:14px;font-weight:700;color:#16161B;margin-bottom:4px;">' + escapeHtml_(repName) + '</div>');
  h.push('<div style="font-size:12px;color:#555;line-height:1.7;"><a href="mailto:' + escapeHtml_(repEmail) + '" style="color:#6551FF;">' + escapeHtml_(repEmail) + '</a><br>Soundtrap for Education</div>');
  h.push('</td>');
  h.push('<td width="2%" style="border-left:1px solid #E5E5EA;"></td>');
  h.push('<td width="49%" style="vertical-align:top;padding-left:20px;">');
  h.push('<div style="font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#6551FF;margin-bottom:8px;">Prepared For</div>');
  h.push('<div style="font-size:14px;font-weight:700;color:#16161B;margin-bottom:4px;">' + escapeHtml_(customerName) + '</div>');
  h.push('<div style="font-size:12px;color:#555;line-height:1.7;">');
  if (data.your_role) h.push(escapeHtml_(data.your_role) + '<br>');
  if (schoolName)     h.push(escapeHtml_(schoolName) + '<br>');
  if (stateCountry)   h.push(escapeHtml_(stateCountry) + '<br>');
  h.push('<a href="mailto:' + escapeHtml_(data.email || '') + '" style="color:#6551FF;">' + escapeHtml_(data.email || '') + '</a>');
  if (accountId !== 'N/A') h.push('<br>Account ID: <strong>' + escapeHtml_(accountId) + '</strong>');
  h.push('</div></td>');
  h.push('</tr></table></td></tr>');

  // Divider
  h.push('<tr><td style="padding:0 36px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td height="1" bgcolor="#E5E5EA" style="background-color:#E5E5EA;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>');

  // ── Subscription section ─────────────────────────────────────
  h.push('<tr><td style="padding:20px 36px;">');
  h.push('<div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#16161B;margin-bottom:16px;">Subscription Details</div>');

  if (quoteType === 'RENEWAL') {
    h.push(buildChangeCards_(
      'Current End Date', escapeHtml_(endDate),
      months + ' Renewal', escapeHtml_(renewalEnd)
    ));
  } else if (quoteType === 'ADD-ON') {
    h.push(buildChangeCards_(
      'Current Seats', escapeHtml_(String(currentSeats)) + ' seats',
      'Total After Add-On', escapeHtml_(String(totalSeats)) + ' seats'
    ));
  } else if (quoteType === 'UPGRADE') {
    h.push(buildChangeCards_(
      escapeHtml_(String(currentPlan)) + ' &middot; ' + escapeHtml_(String(currentSeats)) + ' seats', 'Current Plan',
      escapeHtml_(plan) + ' &middot; ' + escapeHtml_(String(seats)) + ' seats', 'Upgraded Plan'
    ));
  }

  var discountInfo = {
    subStd: subFeeStd, subNet: subFeeNet, subType: subDiscType, subVal: subDiscVal,
    maintStd: maintFeeStd, maintNet: maintFeeNet, maintType: maintDiscType, maintVal: maintDiscVal,
    pdStd: pdCost, pdNet: pdFeeNet, pdType: pdDiscType, pdVal: pdDiscVal,
    totalStd: totalStd, totalNet: totalNet,
  };
  h.push(buildSubscriptionTable_(data, quoteType, plan, seats, months, cost, endDate, currentPlan, currentSeats, addlSeats, currency, pdSession, pdCost, grandTotal, discountInfo));
  if (quoteType === 'NEW' && data.purchase_date) {
    h.push('<p style="font-size:12px;color:#555;margin:10px 0 0;">Planned purchase date: <strong>' + escapeHtml_(formatDateStr_(data.purchase_date)) + '</strong></p>');
  }
  h.push('<p style="font-size:11px;color:#888;margin:12px 0 0;line-height:1.5;">' + escapeHtml_(taxNote) + '</p>');
  h.push('</td></tr>');

  // Divider
  h.push('<tr><td style="padding:0 36px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td height="1" bgcolor="#E5E5EA" style="background-color:#E5E5EA;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>');

  // ── Entity notice ────────────────────────────────────────────
  // Content from config.quoteContent.vendorRegistration (same source as the template).
  h.push('<tr><td style="padding:20px 36px;">');
  h.push(renderVendorRegEmail_(region));
  h.push('</td></tr>');

  // Divider
  h.push('<tr><td style="padding:0 36px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td height="1" bgcolor="#E5E5EA" style="background-color:#E5E5EA;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>');

  // ── Payment methods ──────────────────────────────────────────
  // Content from config.quoteContent.paymentMethods (same source as the template).
  h.push('<tr><td style="padding:20px 36px;">');
  h.push('<div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#16161B;margin-bottom:14px;">Payment Methods</div>');
  h.push(renderPaymentMethodsEmail_(region));
  h.push('</td></tr>');

  // Divider
  h.push('<tr><td style="padding:0 36px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td height="1" bgcolor="#E5E5EA" style="background-color:#E5E5EA;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>');

  // ── Important info ───────────────────────────────────────────
  h.push('<tr><td style="padding:20px 36px;">');
  h.push('<div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#16161B;margin-bottom:12px;">Important Ordering Information</div>');
  h.push('<ul style="margin:0;padding-left:20px;font-size:12px;color:#555;line-height:1.9;">');
  h.push('<li>This document is a <strong>price quote, not an invoice.</strong></li>');
  h.push('<li><strong>Terms of Use:</strong> <a href="https://www.soundtrap.com/legal/terms/edu/us" style="color:#6551FF;">soundtrap.com/legal/terms/edu/us</a></li>');
  h.push('<li>For questions, contact the sales representative listed on this quote or reach out to <a href="mailto:orders@soundtrap.com" style="color:#6551FF;">orders@soundtrap.com</a>.</li>');
  h.push('</ul></td></tr>');

  // ── Footer ───────────────────────────────────────────────────
  h.push('<tr><td bgcolor="#16161B" style="background-color:#16161B;padding:18px 36px;">');
  h.push('<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>');
  h.push('<td style="font-size:11px;color:rgba(253,253,245,0.55);">');
  h.push('Soundtrap for Education &nbsp;&middot;&nbsp; <a href="https://soundtrap.com/edu" style="color:rgba(253,253,245,0.55);">soundtrap.com/edu</a><br>');
  h.push('Quote #' + escapeHtml_(quoteNumber) + ' &nbsp;&middot;&nbsp; Issued ' + escapeHtml_(submDate));
  h.push('</td>');
  h.push('<td style="text-align:right;font-size:11px;"><a href="mailto:orders@soundtrap.com" style="color:#8F8FFF;">orders@soundtrap.com</a></td>');
  h.push('</tr></table></td></tr>');

  // Close outer tables
  h.push('</table></td></tr></table>');
  return h.join('');
}

/** Change-cards row — shows before → after for RENEWAL / ADD-ON / UPGRADE. */
function buildChangeCards_(leftLabel, leftValue, rightLabel, rightValue) {
  var card = 'cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:16px;"';
  return '<table ' + card + '><tr>' +
    '<td width="44%" bgcolor="#F5F3FF" style="background-color:#F5F3FF;border-radius:6px;padding:14px;text-align:center;vertical-align:middle;">' +
      '<div style="font-size:14px;font-weight:700;color:#6551FF;margin-bottom:4px;">' + leftLabel + '</div>' +
      '<div style="font-size:11px;color:#555;">' + leftValue + '</div>' +
    '</td>' +
    '<td width="12%" style="text-align:center;vertical-align:middle;color:#6551FF;font-size:20px;">&#x2192;</td>' +
    '<td width="44%" bgcolor="#EBE9FF" style="background-color:#EBE9FF;border-radius:6px;padding:14px;text-align:center;vertical-align:middle;">' +
      '<div style="font-size:14px;font-weight:700;color:#271B73;margin-bottom:4px;">' + rightLabel + '</div>' +
      '<div style="font-size:11px;color:#555;">' + rightValue + '</div>' +
    '</td>' +
    '</tr></table>';
}

/**
 * Subscription details table with standard / discount / net columns.
 * discountInfo = { subStd, subNet, subType, subVal, maintStd, maintNet, ...,
 *                  pdStd, pdNet, pdType, pdVal, totalStd, totalNet }
 */
function buildSubscriptionTable_(data, quoteType, plan, seats, months, cost, endDate, currentPlan, currentSeats, addlSeats, currency, pdSession, pdCost, grandTotal, discountInfo) {
  pdSession  = pdSession  || '';
  pdCost     = pdCost     || 0;
  grandTotal = grandTotal || cost;
  var di = discountInfo || {};
  var hasDiscount = !!(
    (parseFloat(di.subVal)   || 0) > 0 ||
    (parseFloat(di.maintVal) || 0) > 0 ||
    (parseFloat(di.pdVal)    || 0) > 0
  );

  // Shared cell styles
  var thStyle = 'bgcolor="#16161B" style="background-color:#16161B;color:#FDFDFE;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;padding:10px 12px;text-align:left;"';
  var thR     = 'bgcolor="#16161B" style="background-color:#16161B;color:#FDFDFE;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;padding:10px 12px;text-align:right;"';
  var tdStyle = 'style="font-size:13px;color:#16161B;padding:10px 12px;border-bottom:1px solid #F0F0F0;"';
  var tdR     = 'style="font-size:13px;color:#16161B;padding:10px 12px;border-bottom:1px solid #F0F0F0;text-align:right;"';
  var tdStrike= 'style="font-size:12px;color:#999;padding:10px 12px;border-bottom:1px solid #F0F0F0;text-align:right;text-decoration:line-through;"';
  var tdDisc  = 'style="font-size:12px;color:#6551FF;padding:10px 12px;border-bottom:1px solid #F0F0F0;text-align:right;"';
  var tdNet   = 'style="font-size:13px;font-weight:700;color:#16161B;padding:10px 12px;border-bottom:1px solid #F0F0F0;text-align:right;"';
  var tfL     = 'style="font-size:12px;color:#555;padding:10px 12px;"';
  var tfR     = 'style="font-size:14px;font-weight:700;color:#16161B;padding:10px 12px;text-align:right;"';

  // Build discount pricing rows: one row per line item (sub fee, maint, PD)
  // Shown below the main header/detail rows. Discount cell shows BOTH the
  // monetary saving AND the percentage in parens, e.g. "−$224.70 (−10%)".
  // If `labelIsHtml` is true, the label is inserted verbatim (caller must escape).
  function discRow(label, std, disc, net, discType, discVal, labelIsHtml) {
    var hasDisc = (parseFloat(discVal) || 0) > 0;
    var discStr = hasDisc ? fmtDiscountBoth_(std, disc, currency) : '—';
    var stdCell = hasDisc
      ? '<td ' + tdStrike + '>' + fmtCurrency_(std, currency) + '</td>'
      : '<td ' + tdR      + '>' + fmtCurrency_(std, currency) + '</td>';
    var labelCell = labelIsHtml ? label : escapeHtml_(label);
    return '<tr>' +
      '<td ' + tdStyle + '>' + labelCell + '</td>' +
      stdCell +
      '<td ' + tdDisc  + '>' + escapeHtml_(discStr) + '</td>' +
      '<td ' + tdNet   + '>' + fmtCurrency_(net, currency) + '</td>' +
      '</tr>';
  }

  var h = [];
  h.push('<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">');

  // ── Header section (plan / seats / dates) ─────────────────────
  var thD = 'bgcolor="#271B73" style="background-color:#271B73;color:#FDFDFE;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:7px 12px;"';

  if (quoteType === 'NEW' || quoteType === 'RENEWAL') {
    h.push('<thead><tr>');
    h.push('<th ' + thStyle + '>Plan</th>');
    h.push('<th ' + thStyle + '>Seats</th>');
    if (quoteType === 'RENEWAL') h.push('<th ' + thStyle + '>End Date</th>');
    h.push('<th ' + thStyle + '>Sub. Length</th>');
    h.push('</tr></thead>');
    h.push('<tbody><tr>');
    h.push('<td ' + tdStyle + '>' + escapeHtml_(plan) + '</td>');
    h.push('<td ' + tdStyle + '>' + escapeHtml_(String(seats)) + '</td>');
    if (quoteType === 'RENEWAL') h.push('<td ' + tdStyle + '>' + escapeHtml_(endDate) + '</td>');
    h.push('<td ' + tdStyle + '>' + escapeHtml_(months) + '</td>');
    h.push('</tr>');

  } else if (quoteType === 'ADD-ON') {
    h.push('<thead><tr>');
    h.push('<th ' + thStyle + '>Current Seats</th>');
    h.push('<th ' + thStyle + '>+Additional</th>');
    h.push('<th ' + thStyle + '>End Date</th>');
    h.push('</tr></thead>');
    h.push('<tbody><tr>');
    h.push('<td ' + tdStyle + '>' + escapeHtml_(String(currentSeats)) + '</td>');
    h.push('<td ' + tdStyle + '><strong>+' + escapeHtml_(String(addlSeats)) + '</strong></td>');
    h.push('<td ' + tdStyle + '>' + escapeHtml_(endDate) + '</td>');
    h.push('</tr>');

  } else if (quoteType === 'UPGRADE') {
    var tdU = 'style="font-size:11px;color:#16161B;padding:8px 10px;border-bottom:1px solid #F0F0F0;"';
    h.push('<thead><tr>');
    h.push('<th ' + thStyle + '>Current Plan</th>');
    h.push('<th ' + thStyle + '>Cur. Seats</th>');
    h.push('<th ' + thStyle + '>New Plan</th>');
    h.push('<th ' + thStyle + '>New Seats</th>');
    h.push('<th ' + thStyle + '>End Date</th>');
    h.push('</tr></thead>');
    h.push('<tbody><tr>');
    h.push('<td ' + tdU + '>' + escapeHtml_(String(currentPlan)) + '</td>');
    h.push('<td ' + tdU + '>' + escapeHtml_(String(currentSeats)) + '</td>');
    h.push('<td ' + tdU + '><strong>' + escapeHtml_(plan) + '</strong></td>');
    h.push('<td ' + tdU + '>' + escapeHtml_(String(seats)) + '</td>');
    h.push('<td ' + tdU + '>' + escapeHtml_(endDate) + '</td>');
    h.push('</tr>');
  }
  h.push('</tbody>');

  // ── Pricing sub-table (standard | discount | net) ─────────────
  h.push('<tr><td colspan="' + (quoteType === 'UPGRADE' ? '5' : (quoteType === 'RENEWAL' ? '4' : '3')) + '" style="padding:0;">');
  h.push('<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:4px;">');
  h.push('<thead><tr>');
  h.push('<th ' + thD + ' style="background-color:#271B73;width:40%;">Line Item</th>');
  h.push('<th ' + thD + ' style="background-color:#271B73;text-align:right;">List Price</th>');
  h.push('<th ' + thD + ' style="background-color:#271B73;text-align:right;">Discount</th>');
  h.push('<th ' + thD + ' style="background-color:#271B73;text-align:right;">Net Price</th>');
  h.push('</tr></thead><tbody>');

  // Subscription fee row
  if (di.subStd > 0) {
    h.push(discRow('Subscription Fee', di.subStd, di.subStd - di.subNet, di.subNet, di.subType, di.subVal));
  }
  // Maintenance fee row (District only)
  if (di.maintStd > 0) {
    h.push(discRow('Maintenance Fee', di.maintStd, di.maintStd - di.maintNet, di.maintNet, di.maintType, di.maintVal));
  }
  // PD session row — label uses the same two-line format as the Salesforce-link template:
  // "Professional Development" main label + the session name (with "PD " stripped) as subtext.
  if (pdSession && di.pdStd > 0) {
    var pdSessionDisplay = pdSession.replace(/\bPD\s+/g, '');
    var pdLabelHtml = 'Professional Development<br>' +
      '<span style="font-size:11px;color:rgba(22,22,22,0.5);">' + escapeHtml_(pdSessionDisplay) + '</span>';
    h.push(discRow(pdLabelHtml, di.pdStd, di.pdStd - di.pdNet, di.pdNet, di.pdType, di.pdVal, true));
  }
  // Complimentary Introductory PD row — shown when district enrollment > 1000.
  var compPd = (parseInt(String(data.district_enrollment || '').replace(/[^0-9]/g, ''), 10) || 0) > 1000;
  if (compPd) {
    var compLabelHtml = 'Complimentary Introductory Professional Development<br>' +
      '<span style="font-size:11px;color:rgba(22,22,22,0.5);">3 hours — included at no charge</span>';
    h.push(discRow(compLabelHtml, 0, 0, 0, '', 0, true));
  }

  h.push('</tbody>');

  // Total footer — shows strikethrough standard total, total discount (monetary + %),
  // and net total.  Every cell gets the same `border-top:2px solid #E5E5EA` so the
  // separator line above the Total row is uniform (no lighter gap).
  var stdTotalFmt = di.totalStd > 0 ? fmtCurrency_(di.totalStd, currency) : '';
  var netTotalFmt = di.totalNet > 0 ? fmtCurrency_(di.totalNet, currency) : escapeHtml_(grandTotal);
  var totalDiscAmt = (di.totalStd || 0) - (di.totalNet || 0);
  var totalDiscFmt = (hasDiscount && totalDiscAmt > 0)
    ? fmtDiscountBoth_(di.totalStd, totalDiscAmt, currency)
    : '';

  var totalBorder = 'border-top:2px solid #E5E5EA;';
  var stdTotalCell = (hasDiscount && di.totalStd > 0)
    ? '<td style="font-size:12px;color:#999;padding:10px 12px;text-align:right;text-decoration:line-through;' + totalBorder + '">' + stdTotalFmt + '</td>'
    : '<td style="padding:10px 12px;text-align:right;' + totalBorder + '"></td>';

  h.push('<tfoot><tr>');
  h.push('<td style="font-size:12px;font-weight:700;color:#555;padding:10px 12px;' + totalBorder + '">Total</td>');
  h.push(stdTotalCell);
  h.push('<td style="font-size:12px;color:#6551FF;padding:10px 12px;text-align:right;' + totalBorder + '">' + escapeHtml_(totalDiscFmt) + '</td>');
  h.push('<td style="font-size:14px;font-weight:800;color:#16161B;padding:10px 12px;text-align:right;' + totalBorder + '">' + netTotalFmt + '</td>');
  h.push('</tr></tfoot>');
  h.push('</table></td></tr>');

  h.push('</table>');
  return h.join('');
}

// ════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════

/**
 * Normalise quote type: maps 'UPGRADE PLAN' (form value) → 'UPGRADE' (internal key).
 * All other values are returned as-is uppercased.
 */
function normaliseQuoteType_(qt) {
  var t = (qt || 'NEW').toUpperCase();
  return t === 'UPGRADE PLAN' ? 'UPGRADE' : t;
}

// ════════════════════════════════════════════════════════════
//  SALESFORCE INTEGRATION
// ════════════════════════════════════════════════════════════

/**
 * Authenticates with Salesforce using the Client Credentials OAuth flow.
 * Credentials are read from Script Properties (SF_CLIENT_ID, SF_CLIENT_SECRET).
 * Returns { token, instanceUrl }.
 */
function getSalesforceToken_() {
  var props        = PropertiesService.getScriptProperties();
  var clientId     = props.getProperty('SF_CLIENT_ID');
  var clientSecret = props.getProperty('SF_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    throw new Error('Salesforce credentials not set. Add SF_CLIENT_ID and SF_CLIENT_SECRET in Script Properties.');
  }

  var response = UrlFetchApp.fetch(SF_INSTANCE_URL + '/services/oauth2/token', {
    method:           'post',
    muteHttpExceptions: true,
    payload: {
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
    },
  });

  var body = JSON.parse(response.getContentText());
  if (!body.access_token) {
    throw new Error('Salesforce auth failed: ' + response.getContentText());
  }
  return { token: body.access_token, instanceUrl: body.instance_url || SF_INSTANCE_URL };
}

/**
 * Creates a Quote record in Salesforce from the submitted form data.
 * Returns { id } on success; throws on failure.
 */
function createSalesforceQuote_(data, quoteNumber, timestamp) {
  var auth      = getSalesforceToken_();
  var quoteType = (data.quote_type || 'NEW').toUpperCase();
  var currency  = currencyForCountry_(data.country || '');
  var seats     = parseInt(data.number_of_seats || 0, 10);

  // ── Core fields (always populated) ──────────────────────────
  var record = {
    Name:                    quoteNumber,
    Type__c:                 quoteType,
    Add_On__c:               quoteType === 'ADD-ON',
    Upgrade__c:              quoteType === 'UPGRADE',
    School_Name__c:          data.school_name        || '',
    District__c:             data.school_district    || '',
    EDU_Account_ID__c:       data.soundtrap_account_id || '',
    Sales_Representative__c: data.account_manager    || '',
    Sales_Rep_Email__c:      data.account_manager_email || '',
    Quote_Created_By__c:     Session.getActiveUser().getEmail() || '',
    Soundtrap_Plan__c:       data.plan               || '',
    First_Name__c:           data.firstname          || '',
    Last_Name__c:            data.lastname           || '',
    Email:                   data.email              || '',
    CurrencyIsoCode:         currency,
    QuoteToCity:             data.city    || '',
    QuoteToState:            stateAbbrev_(data.state) || '',
    QuoteToCountry:          data.country || '',
    Subscription_Length_Months__c: parseInt(data.subscription_length || 0, 10) || null,
    Requested_At__c:         Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssZ"),
    ExpirationDate:          Utilities.formatDate(addDays_(timestamp, loadConfig_().quoteValidDays), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    Status:                  'New',
  };

  // ── Seats — mapped by quote type ────────────────────────────
  if (quoteType === 'NEW') {
    record.Seats_Number_NEW__c = seats || null;
  } else if (quoteType === 'RENEWAL') {
    record.Seats_Number_RENEWAL__c = seats || null;
  } else if (quoteType === 'ADD-ON') {
    record.Current_Seats__c    = parseInt(data.current_seats    || 0, 10) || null;
    record.Additional_Seats__c = parseInt(data.additional_seats || 0, 10) || null;
  } else if (quoteType === 'UPGRADE') {
    record.Current_Plan_for_UPGRADE__c = data.current_plan || '';
    record.Seats_on_upgraded_plan__c   = seats || null;
    record.Upgrade_to_Plan__c          = data.plan || '';
  }

  // ── District plan extras ─────────────────────────────────────
  if ((data.plan || '').toLowerCase() === 'district') {
    record.Schools_Number_on_District__c = parseInt(data.number_of_schools || 0, 10) || null;
  }

  // ── Quote link ───────────────────────────────────────────────
  if (DEPLOYMENT_URL) {
    record.Quote_Link__c = DEPLOYMENT_URL + '?q=' + encodeURIComponent(quoteNumber);
  }

  // ── NCES numbers + Account lookup ───────────────────────────
  if (data.nces_number) {
    var nces12 = String(data.nces_number).replace(/\s/g, '');
    var nces7  = nces12.substring(0, 7);
    record.NCES_School_Number__c   = nces12;
    record.NCES_District_Number__c = nces7;
    var accountId = findAccountByNces_(auth, nces12);
    if (accountId) record.AccountId = accountId;
  } else if (data.district_nces) {
    // District-only selection (typeahead): no 12-digit school NCES, but the
    // frontend derived the 7-digit district LEAID from a member school.
    var leaid = String(data.district_nces).replace(/\s/g, '');
    record.NCES_District_Number__c = leaid;
    var districtAcct = findAccountByNces_(auth, leaid);  // falls through to district-number match
    if (districtAcct) record.AccountId = districtAcct;
  }

  // ── Fee calculations ─────────────────────────────────────────
  var months  = parseInt(data.subscription_length || 12, 10);
  var schools = parseInt(data.number_of_schools   || 0,  10);
  var pdFee   = data.pd_session ? (loadConfig_().pdPrices[data.pd_session] || 0) : 0;

  var subscriptionFee = 0;
  var maintenanceFee  = 0;

  if (quoteType === 'NEW' || quoteType === 'RENEWAL') {
    var annualPricing = calcPrice_(seats, data.plan || '', schools, currency);
    if (annualPricing) {
      subscriptionFee = Math.round(calcMultiYearPrice_(annualPricing.seats, months));
      maintenanceFee  = Math.round(annualPricing.maintenance * (months / 12));
    }
  } else {
    // ADD-ON / UPGRADE: pro-rata total (maintenance delta is embedded in the calculation)
    var costObj = calcSubscriptionCost_(data, currency);
    if (costObj && costObj.value) subscriptionFee = costObj.value;
  }

  var totalCost = subscriptionFee + maintenanceFee + pdFee;

  if (subscriptionFee) record.Subscription_Fee__c         = subscriptionFee;
  if (maintenanceFee)  record.District_Maintenance_Fee__c = maintenanceFee;
  if (pdFee)           record.PD_Fee__c                   = pdFee;
  // Total_Standard_Cost__c and Total_Discounted_Cost__c are formula fields in Salesforce.

  // ── Discounted fees ──────────────────────────────────────────
  var subDiscType   = data.sub_discount_type   || '%';
  var subDiscVal    = parseFloat(data.sub_discount_value)   || 0;
  var maintDiscType = data.maint_discount_type  || '%';
  var maintDiscVal  = parseFloat(data.maint_discount_value) || 0;
  var pdDiscType    = data.pd_discount_type    || '%';
  var pdDiscVal     = parseFloat(data.pd_discount_value)    || 0;

  var subFeeDisc   = subDiscVal   ? applyDiscount_(subscriptionFee, subDiscType,   subDiscVal)   : subscriptionFee;
  var maintFeeDisc = maintDiscVal ? applyDiscount_(maintenanceFee,  maintDiscType, maintDiscVal) : maintenanceFee;
  var pdFeeDisc    = pdDiscVal    ? applyDiscount_(pdFee,           pdDiscType,    pdDiscVal)    : pdFee;

  if (subFeeDisc   && subFeeDisc   !== subscriptionFee) record.Discounted_Subscription_Fee__c = subFeeDisc;
  if (maintFeeDisc && maintFeeDisc !== maintenanceFee)  record.Discounted_Maintenance_Fee__c  = maintFeeDisc;
  if (pdFeeDisc    && pdFeeDisc    !== pdFee)           record.Discounted_PD_Fee__c           = pdFeeDisc;

  // ── Optional fields ──────────────────────────────────────────
  if (data.purchase_date)         record.Expected_date_of_purchase__c      = data.purchase_date;
  if (data.pd_session)            record.PD_Session__c                     = data.pd_session;
  if (data.subscription_end_date) record.Current_Subscription_End_Date__c  = data.subscription_end_date;
  if (data.use_case)              record.Use_Case__c                        = data.use_case;
  if (data.your_role)             record.Customer_Role__c                   = data.your_role;
  if (data.school_website)        record.School_Website__c                  = data.school_website;

  // ── Remove null/empty optional numerics to avoid SF type errors ──
  Object.keys(record).forEach(function (k) {
    if (record[k] === null || record[k] === '') delete record[k];
  });

  var response = UrlFetchApp.fetch(
    auth.instanceUrl + '/services/data/' + SF_API_VERSION + '/sobjects/Quote/',
    {
      method:             'post',
      contentType:        'application/json',
      headers:            { 'Authorization': 'Bearer ' + auth.token },
      payload:            JSON.stringify(record),
      muteHttpExceptions: true,
    }
  );

  var status = response.getResponseCode();
  var body   = JSON.parse(response.getContentText());

  if (status === 201 && body.id) {
    return { id: body.id };
  }

  // Parse Salesforce error message
  var errMsg = (Array.isArray(body) && body[0] && body[0].message)
    ? body[0].message
    : response.getContentText();
  throw new Error(errMsg);
}

/**
 * Looks up a Salesforce Account by NCES number.
 * Tries 12-digit school NCES first (NCES_School_Number__c),
 * then falls back to 7-digit district LEAID (NCES_District_Number__c).
 * Returns the Account Id string, or null if not found.
 *
 * @param {Object} auth  - { token, instanceUrl } from getSalesforceToken_()
 * @param {string} nces  - 12-digit school NCES code
 * @returns {string|null}
 */
function findAccountByNces_(auth, nces) {
  var nces12 = String(nces).replace(/\s/g, '');
  var nces7  = nces12.substring(0, 7);

  var queries = [
    "SELECT Id FROM Account WHERE NCES_School_Number__c = '" + nces12 + "' LIMIT 1",
    "SELECT Id FROM Account WHERE NCES_District_Number__c = '" + nces7 + "' LIMIT 1",
  ];

  for (var i = 0; i < queries.length; i++) {
    try {
      var response = UrlFetchApp.fetch(
        auth.instanceUrl + '/services/data/' + SF_API_VERSION + '/query?q=' + encodeURIComponent(queries[i]),
        {
          method:             'get',
          headers:            { 'Authorization': 'Bearer ' + auth.token },
          muteHttpExceptions: true,
        }
      );
      if (response.getResponseCode() === 200) {
        var body = JSON.parse(response.getContentText());
        if (body.records && body.records.length > 0) {
          return body.records[0].Id;
        }
      }
    } catch (e) {
      // Non-fatal — log and continue
      Logger.log('findAccountByNces_ query ' + i + ' failed: ' + e.message);
    }
  }

  return null;
}

/**
 * Send a Slack notification about a new quote submission.
 * Reads SLACK_WEBHOOK_URL from Script Properties (per-project). Best-effort:
 * any failure is logged but does NOT break the submission.
 *
 *   data         — submission data (already parsed in doPost / submitQuote)
 *   quoteNumber  — generated quote number
 *   timestamp    — submission timestamp (Date)
 *   sfRecordId   — Salesforce Quote record ID, if available
 *                  (prefers the SF record URL; falls back to the doGet ?q= URL)
 */
function sendSlackNotification_(data, quoteNumber, timestamp, sfRecordId) {
  var webhookUrl = '';
  try {
    webhookUrl = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL') || '';
  } catch (_e) { return; }
  if (!webhookUrl) return;  // Not configured — skip silently

  var quoteType = normaliseQuoteType_(data.quote_type);

  // Seats: ADD-ON uses additional_seats; everything else uses number_of_seats
  var seats = (quoteType === 'ADD-ON'
    ? (data.additional_seats || data.number_of_seats || '')
    : (data.number_of_seats || ''));

  var customerName = ((data.firstname || '') + ' ' + (data.lastname || '')).trim();
  var schoolName   = data.school_name || data.school_district || '';
  var createdOn    = Utilities.formatDate(
    timestamp || new Date(),
    Session.getScriptTimeZone(),
    'MMM d, yyyy HH:mm'
  );

  // URL preference: SF record > doGet view URL. Both are clickable in Slack.
  var quoteUrl = '';
  if (sfRecordId) {
    quoteUrl = SF_INSTANCE_URL + '/' + sfRecordId;
  } else if (DEPLOYMENT_URL) {
    quoteUrl = DEPLOYMENT_URL + '?q=' + encodeURIComponent(quoteNumber);
  }

  var repName  = data.account_manager || 'The Soundtrap Team';

  var lines = [
    'Hello, *' + repName + '*',
    '',
    'A new quote has been downloaded in your territory',
    quoteUrl ? '<' + quoteUrl + '|Salesforce Quote URL>' : '',
    '',
    '*Number of Seats:* ' + seats,
    '*School Name:* ' + schoolName,
    '*Soundtrap Plan:* ' + (data.plan || ''),
    '*Order Type:* ' + quoteType,
    '*Country:* ' + (data.country || ''),
    '*State:* ' + (data.state || ''),
    '*Quote Number:* ' + quoteNumber,
    '*Created on:* ' + createdOn,
    '*Requested by:* ' + customerName,
    "*Requestor's comments:* " + (data.use_case || '—'),
    '*Email Address:* ' + (data.email || ''),
  ];

  try {
    UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ text: lines.join('\n') }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    // Slack failure should never break the submission
    if (typeof console !== 'undefined' && console.log) {
      console.log('Slack notification failed: ' + (e.message || e));
    }
  }
}

/**
 * Sends an admin alert email when a Salesforce sync fails.
 */
function sendSFErrorAlert_(quoteNumber, customerName, errorMessage) {
  var recipient = SF_ALERT_EMAIL || 'matteo@soundtrap.com';
  GmailApp.sendEmail(
    recipient,
    '[Action Required] Salesforce Sync Failed — ' + quoteNumber,
    [
      'A Salesforce Quote record could not be created automatically.',
      '',
      'Quote Number : ' + quoteNumber,
      'Customer     : ' + customerName,
      'Error        : ' + errorMessage,
      '',
      'The submission has been saved to the Google Sheet.',
      'Please create the Salesforce record manually using the data in the sheet.',
    ].join('\n'),
    { name: 'Soundtrap Quote Form — System Alert' }
  );
}

// ════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════

/** Build a column-name → index map from the COLUMNS array. */
function buildColIndex_() {
  var idx = {};
  COLUMNS.forEach(function(col, i) { idx[col] = i; });
  return idx;
}

/** Map a country string to its region: 'US' | 'Canada' | 'ANZ' | 'ROW' */
function regionForCountry_(country) {
  var cfg = loadConfig_();
  return (cfg.regionByCountry && cfg.regionByCountry[country]) || 'ROW';
}

/** Map a country string to its currency code. */
function currencyForCountry_(country) {
  var cfg = loadConfig_();
  if (cfg.currencyByCountry && cfg.currencyByCountry[country]) {
    return cfg.currencyByCountry[country];
  }
  if (cfg.eurozone && cfg.eurozone.indexOf(country) !== -1) return 'EUR';
  return 'USD';
}

/**
 * Convert a full US state/territory name to its USPS 2-letter code for Salesforce.
 * Map lives in config.json (usStateAbbrev). Non-US or unmapped values (and values
 * that are already abbreviations) are returned unchanged.
 */
function stateAbbrev_(stateName) {
  var s = (stateName || '').trim();
  if (!s) return '';
  var map = loadConfig_().usStateAbbrev || {};
  if (map[s]) return map[s];
  var lc = s.toLowerCase();
  for (var k in map) {
    if (k !== '_comment' && k.toLowerCase() === lc) return map[k];
  }
  return s;
}

/** Format a Date object as "Mar 28, 2026". */
function formatDate_(d) {
  var months = ['Jan','Feb','Mar','Apr','May','Jun',
                'Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

/** Parse any date string (ISO, long, sheet serial) and return "Mar 28, 2026". */
function formatDateStr_(str) {
  if (!str) return '\u2014';
  try {
    var d = new Date(str);
    if (isNaN(d.getTime())) return String(str);
    return formatDate_(d);
  } catch (_) { return String(str); }
}

/** Return a new Date n days after d. */
function addDays_(d, n) {
  return new Date(d.getTime() + n * 86400000);
}

/** Format a month count as "12 months (1 year)" etc. */
function formatMonths_(n) {
  if (n === 12) return '12 months (1 year)';
  if (n === 24) return '24 months (2 years)';
  if (n === 36) return '36 months (3 years)';
  return n + ' months';
}

/**
 * Calculate renewal end date from subscription_end_date + subscription_length months.
 * Accepts dates in formats like "2026-06-30", "June 30, 2026", "06/30/2026".
 */
function calcRenewalEndDate_(data) {
  var endDateStr = data.subscription_end_date || '';
  var months     = parseInt(data.subscription_length || 12);
  if (!endDateStr) return '';
  try {
    var d = new Date(endDateStr);
    if (isNaN(d.getTime())) return '';
    d.setMonth(d.getMonth() + months);
    return formatDate_(d);
  } catch (_) {
    return '';
  }
}

/** Format a number as a currency string — mirrors fmtCurrency() in quote-form.html. */
function fmtCurrency_(amount, currency) {
  var sym = { USD:'$', GBP:'\u00a3', EUR:'\u20ac', SEK:'kr\u00a0', NOK:'kr\u00a0', CAD:'CA$\u00a0', AUD:'A$\u00a0' };
  var suf = { SEK:'\u00a0SEK', NOK:'\u00a0NOK' };
  var s        = sym[currency] || '$';
  var f        = suf[currency] || '';
  var decimals = (currency === 'SEK' || currency === 'NOK') ? 0 : 2;
  var formatted = amount.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return s + formatted + f;
}

/**
 * Apply a discount (% or $) to a base amount server-side.
 * Returns the net amount (never negative).
 */
function applyDiscount_(base, type, value) {
  var v = parseFloat(value) || 0;
  if (!v || !base) return base;
  if (type === '%') return Math.max(0, Math.round(base * (1 - v / 100)));
  return Math.max(0, Math.round(base - v));
}

/** Format a discount as a human-readable string, e.g. "5%" or "−$250". */
function fmtDiscount_(type, value, currency) {
  var v = parseFloat(value) || 0;
  if (!v) return '—';
  if (type === '%') return '−' + v + '%';
  return '−' + fmtCurrency_(v, currency);
}

/**
 * Format a discount showing BOTH the monetary saving and the percentage,
 * e.g. "−$224.70 (−10%)" or "−$2,013.00 (−25.7%)".
 *
 * The percentage uses 1 decimal place when rounding to a whole number would
 * lose precision by more than 0.05% (so per-line clean inputs like 10% / 25%
 * still display as integers, but blended totals like 25.67% show as "25.7%"
 * instead of misleadingly rounding to "26%").
 *
 *   base       = standard (pre-discount) price
 *   discAmount = monetary amount being discounted (std − net)
 *   currency   = display currency
 */
function fmtDiscountBoth_(base, discAmount, currency) {
  var amt = parseFloat(discAmount) || 0;
  var b   = parseFloat(base) || 0;
  if (!amt || !b) return '—';
  var pctRaw     = (amt / b) * 100;
  var pctRounded = Math.round(pctRaw);
  var pctDisplay = (Math.abs(pctRaw - pctRounded) < 0.05)
    ? String(pctRounded)
    : pctRaw.toFixed(1);
  return '−' + fmtCurrency_(amt, currency) + ' (−' + pctDisplay + '%)';
}

/** Escape a string for safe insertion into HTML. */
function escapeHtml_(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Quote-number format: INT-2026-00042 */
function generateQuoteNumber_() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var counter = ss.getSheetByName('Counter');
  var cell    = counter.getRange('A1');
  var n       = (cell.getValue() || 0) + 1;
  cell.setValue(n);
  var year = new Date().getFullYear();
  return 'INT-' + year + '-' + String(n).padStart(5, '0');
}

// ════════════════════════════════════════════════════════════
//  ONE-TIME SETUP
// ════════════════════════════════════════════════════════════

/**
 * Call manually from the Apps Script editor to create the
 * Submissions and Counter sheets with headers and styling.
 */
function initSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── Submissions sheet ──
  var sub = ss.getSheetByName('Submissions');
  if (!sub) {
    sub = ss.insertSheet('Submissions');
  }
  if (!sub.getRange('A1').getValue()) {
    sub.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
    var header = sub.getRange(1, 1, 1, COLUMNS.length);
    header.setBackground('#16161B');
    header.setFontColor('#FDFDFE');
    header.setFontWeight('bold');
    sub.setFrozenRows(1);
    sub.setColumnWidth(1, 140);   // Quote Number
    sub.setColumnWidth(2, 160);   // Timestamp
    sub.setColumnWidth(14, 220);  // Email
    sub.setColumnWidth(25, 200);  // Account Manager
    sub.setColumnWidth(26, 220);  // Account Manager Email
  }

  // ── Counter sheet ──
  var ctr = ss.getSheetByName('Counter');
  if (!ctr) {
    ctr = ss.insertSheet('Counter');
    ctr.getRange('A1').setValue(0);
    ctr.getRange('A1').setNote('Auto-incremented quote counter. Do not edit manually.');
  }

  Logger.log('✅ Sheets created and ready.');
}

// ════════════════════════════════════════════════════════════
//  DIAGNOSTIC — run manually from the Apps Script editor
// ════════════════════════════════════════════════════════════

/**
 * Run this function from the Apps Script editor (▶ Run button) to:
 *  1. Trigger OAuth authorization for GmailApp if not yet granted.
 *  2. Send a test quote email (inline, no attachment) to your own address.
 * Check View → Executions for any error messages.
 */
function testQuoteEmail() {
  var mockData = {
    quote_type:            'NEW',
    country:               'United States',
    state:                 'California',
    city:                  'San Francisco',
    school_district:       'San Francisco Unified School District',
    school_name:           'Mission High School',
    firstname:             'Jane',
    lastname:              'Smith',
    email:                 Session.getActiveUser().getEmail(),
    your_role:             'Music Teacher',
    soundtrap_account_id:  'TEST-12345',
    plan:                  'School',
    number_of_seats:       '150',
    subscription_length:   '12',
    number_of_schools:     '',
    account_manager:       'Test Rep',
    account_manager_email: Session.getActiveUser().getEmail(),
    territory:             'West',
    use_case:              'Music production class for grades 9–12.',
    school_website:        'missionhigh.sfusd.edu',
  };

  var quoteNumber = 'DIR-TEST-00001';
  var timestamp   = new Date();

  try {
    Logger.log('Generating and sending quote…');
    generateAndSendQuote_(mockData, quoteNumber, timestamp);
    Logger.log('✅ Done — open the email to see the inline quote.');
  } catch (e) {
    Logger.log('ERROR: ' + e.message);
    throw e;
  }
}

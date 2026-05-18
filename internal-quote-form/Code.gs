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
  'School Type',
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
  school_type:            'School Type',
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

// ── Professional Development pricing (USD, US-only) ─────────
var PD_PRICES = {
  '1 hour Virtual PD for up to 50 teachers':    499,
  '1 hour Virtual PD for more than 50 teachers': 599,
  'In Person PD for 3 hours':                  3499,
  'In Person PD for 6 hours':                  4499,
};

// ── Territory maps — mirrors internal-quote-form.html (used for district rep routing) ──
// US state → POD name (3,000+ student accounts)
var STATE_POD = {
  'alaska':'Northwest','california':'Northwest','idaho':'Northwest','montana':'Northwest',
  'nevada':'Northwest','oregon':'Northwest','washington':'Northwest','wyoming':'Northwest',
  'arizona':'Southwest','arkansas':'Southwest','colorado':'Southwest','hawaii':'Southwest',
  'kansas':'Southwest','missouri':'Southwest','nebraska':'Southwest','new mexico':'Southwest',
  'oklahoma':'Southwest','texas':'Southwest','utah':'Southwest',
  'illinois':'Central','indiana':'Central','iowa':'Central','michigan':'Central',
  'minnesota':'Central','north dakota':'Central','ohio':'Central','south dakota':'Central',
  'wisconsin':'Central',
  'connecticut':'Northeast','maine':'Northeast','massachusetts':'Northeast',
  'new hampshire':'Northeast','new jersey':'Northeast','new york':'Northeast',
  'rhode island':'Northeast','vermont':'Northeast',
  'alabama':'Southeast','delaware':'Southeast','district of columbia':'Southeast',
  'florida':'Southeast','georgia':'Southeast','kentucky':'Southeast','louisiana':'Southeast',
  'maryland':'Southeast','mississippi':'Southeast','north carolina':'Southeast',
  'pennsylvania':'Southeast','south carolina':'Southeast','tennessee':'Southeast',
  'virginia':'Southeast','west virginia':'Southeast',
};
// POD → rep { name, email } — keep in sync with internal-quote-form.html podRep
var POD_REP = {
  'Northwest': { name: 'Brittany Follet',   email: 'brittany@soundtrap.com'  },
  'Southwest': { name: 'Maria Opirhory',    email: 'maria@soundtrap.com'     },
  'Central':   { name: 'Chloe Taylor',      email: 'chloe@soundtrap.com'     },
  'Northeast': { name: 'Chad Reisfelt',    email: 'chad@soundtrap.com'   },
  'Southeast': { name: 'Tina Shah',         email: 'tina@soundtrap.com'      },
};

// ── Quote generation config ──────────────────────────────────

// Deployment URL — same URL as appsScriptUrl in quote-form.html.
// Used to build the PRINT link in customer emails. Leave empty to disable.
var DEPLOYMENT_URL = 'https://script.google.com/a/macros/soundtrap.com/s/AKfycbxptbB_caLVfRwhJ0hvIJHi6MeT7WxSyfozFmlPfWQrDUxG7wGje1Om5WjNXCAC4S8yjQ/exec';

// How many days the quote remains valid.
var QUOTE_VALID_DAYS = 30;

// ── Pricing matrix (mirrors quote-form.html PRICING) ─────────
// Tiers cover seat bands: 1–50 | 51–500 | 501–1k | 1k–5k |
//   5k–10k | 10k–20k | 20k–50k | 50k–150k | 150k+
// m = maintenance cost per school per year (District only).
var PRICING = {
  USD: {
    School:    { t:[9.98,9.60,9.10,8.60,8.60,8.60,8.60,8.60,8.60], m:0 },
    Classroom: { t:[7.98,7.60,7.30,6.90,6.90,6.90,6.90,6.90,6.90], m:0 },
    District:  { t:[14.98,14.98,14.98,14.98,14.98,14.98,14.98,14.98,14.98], m:249 },
    Legacy:    { t:[7.98,7.70,7.30,6.90,6.30,5.90,5.60,5.10,4.60], m:0 }
  },
  GBP: {
    School:    { t:[8.18,7.80,7.50,7.10,7.10,7.10,7.10,7.10,7.10], m:0 },
    Classroom: { t:[6.58,6.20,6.00,5.70,5.70,5.70,5.70,5.70,5.70], m:0 },
    District:  { t:[12.18,12.18,12.18,12.18,12.18,12.18,12.18,12.18,12.18], m:189 },
    Legacy:    { t:[6.58,6.20,6.00,5.70,5.30,5.00,4.70,4.20,3.80], m:0 }
  },
  EUR: {
    School:    { t:[9.38,9.10,8.60,8.20,8.20,8.20,8.20,8.20,8.20], m:0 },
    Classroom: { t:[7.58,7.30,6.90,6.60,6.60,6.60,6.60,6.60,6.60], m:0 },
    District:  { t:[14.18,14.18,14.18,14.18,14.18,14.18,14.18,14.18,14.18], m:229 },
    Legacy:    { t:[7.58,7.30,6.90,6.60,6.10,5.60,5.40,4.90,4.50], m:0 }
  },
  SEK: {
    School:    { t:[105,100,96,91,91,91,91,91,91], m:0 },
    Classroom: { t:[85,80,76,73,73,73,73,73,73], m:0 },
    District:  { t:[157.98,157.98,157.98,157.98,157.98,157.98,157.98,157.98,157.98], m:2499 },
    Legacy:    { t:[85,81,77,73,68,63,60,55,49], m:0 }
  },
  NOK: {
    School:    { t:[105,100,96,91,91,91,91,91,91], m:0 },
    Classroom: { t:[85,82,78,73,73,73,73,73,73], m:0 },
    District:  { t:[157.98,157.98,157.98,157.98,157.98,157.98,157.98,157.98,157.98], m:2699 },
    Legacy:    { t:[85,82,78,73,68,64,59,55,50], m:0 }
  },
  CAD: {
    School:    { t:[11.18,10.80,10.30,9.70,9.70,9.70,9.70,9.70,9.70], m:0 },
    Classroom: { t:[8.98,8.70,8.20,7.70,7.70,7.70,7.70,7.70,7.70], m:0 },
    District:  { t:[16.78,16.78,16.78,16.78,16.78,16.78,16.78,16.78,16.78], m:349 },
    Legacy:    { t:[8.98,8.70,8.20,7.70,7.10,6.70,6.40,5.80,5.30], m:0 }
  },
  AUD: {
    School:    { t:[15.38,14.80,14.10,13.30,13.30,13.30,13.30,13.30,13.30], m:0 },
    Classroom: { t:[12.38,11.80,11.30,10.60,10.60,10.60,10.60,10.60,10.60], m:0 },
    District:  { t:[23.18,23.18,23.18,23.18,23.18,23.18,23.18,23.18,23.18], m:389 },
    Legacy:    { t:[12.90,12.40,11.80,11.10,10.10,9.60,9.00,8.30,7.90], m:0 }
  }
};

// ── Salesforce integration config ───────────────────────────
// Store credentials via Apps Script editor:
//   Project Settings → Script Properties → Add:
//     SF_CLIENT_ID     = your Consumer Key
//     SF_CLIENT_SECRET = your Consumer Secret
var SF_INSTANCE_URL  = 'https://soundtrap.my.salesforce.com';
var SF_API_VERSION   = 'v59.0';
// Email to notify on Salesforce sync failure.
var SF_ALERT_EMAIL   = 'matteo@soundtrap.com';

// Tax notes — one per region.
var TAX_NOTES = {
  'US':     'Taxes — e.g., state sales tax — are not included in this quote.',
  'Canada': 'Applicable Canadian taxes (GST/HST/PST) are not included in this quote.',
  'ROW':    'Taxes — e.g., VAT, GST, or other applicable taxes — are not included in this quote.',
  'ANZ':    'Taxes — e.g., VAT, GST, or other applicable taxes — are not included in this quote.',
};


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
    'district','school','school_type','quote_type','plan','seats','schools','months',
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
  var region    = regionForCountry_(data.country || '');
  var currency  = currencyForCountry_(data.country || '');
  var quoteType = normaliseQuoteType_(data.quote_type);
  var emailHtml = buildTemplateQuote_(data, quoteNumber, timestamp, region, currency, quoteType, true);
  sendCustomerEmail_(data, quoteNumber, emailHtml);
}

/**
 * Build the full {{Placeholder}} → value map.
 */
function buildPlaceholderMap_(data, quoteNumber, timestamp, region, currency) {
  var totalSeatsAfterAddon = (parseInt(data.current_seats || 0) + parseInt(data.additional_seats || 0)) || '';

  return {
    '{{QuoteNumber}}':           quoteNumber,
    '{{SubmissionDate}}':        formatDate_(timestamp),
    '{{ValidUntil}}':            formatDate_(addDays_(timestamp, QUOTE_VALID_DAYS)),
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
    '{{SubscriptionLength}}':    formatMonths_(parseInt(data.subscription_length || 12)),
    '{{SubscriptionCost}}':      calcSubscriptionCost_(data, currency).formatted,
    '{{TaxNote}}':               TAX_NOTES[region] || TAX_NOTES['ROW'],
    '{{SubscriptionEndDate}}':   data.subscription_end_date  || '',
    '{{RenewalEndDate}}':        calcRenewalEndDate_(data),
    '{{CurrentPlan}}':           data.current_plan           || '',
    '{{CurrentSeats}}':          data.current_seats          || '',
    '{{AdditionalSeats}}':       data.additional_seats       || '',
    '{{TotalSeatsAfterAddon}}':  totalSeatsAfterAddon        || '',
  };
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
  var taxNote = TAX_NOTES[region] || TAX_NOTES['ROW'];
  html = html.replace(
    /(<span[^>]*data-placeholder="TaxNote"[^>]*>)[^<]*(<\/span>)/gi,
    '$1' + escapeHtml_(taxNote) + '$2'
  );

  return html;
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
    '(<(?:section|div|span|header|footer)[^>]*' +
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
  var row = PRICING[currency] && PRICING[currency][plan];
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
  return PD_PRICES[pdSession] || 0;
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

  GmailApp.sendEmail(
    data.email,
    subject,
    'Hi ' + customerName + ', please view this email in an HTML-capable client to see your Soundtrap price quote (' + quoteNumber + ').',
    {
      htmlBody: emailHtml,
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
  var validUntil   = formatDate_(addDays_(timestamp, QUOTE_VALID_DAYS));
  var taxNote      = TAX_NOTES[region] || TAX_NOTES['ROW'];
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
  h.push('<tr><td style="padding:20px 36px;">');
  h.push('<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>');
  h.push('<td bgcolor="#F5F3FF" style="background-color:#F5F3FF;border-radius:6px;padding:14px 16px;font-size:12px;color:#333;line-height:1.6;">');
  h.push('<strong>&#x1F3E2; Vendor Registration:</strong> ');
  if (region === 'US') {
    h.push('Soundtrap is now an independent entity and no longer part of Spotify. Please ensure <strong>Soundtrap US Inc.</strong> is correctly registered in your systems. <strong>Paper checks are only accepted at: Soundtrap US Inc., PO Box 18375, Palatine, IL 60055-8375.</strong>');
  } else if (region === 'Canada') {
    h.push('Canadian orders are fulfilled by <strong>Soundtrap US Inc.</strong> Please ensure Soundtrap US Inc. is correctly registered in your systems before placing an order.');
  } else {
    h.push('International orders are fulfilled by <strong>Soundtrap AB</strong> (Sweden). Please contact your sales representative for region-specific invoicing and tax documentation.');
  }
  h.push('</td></tr></table></td></tr>');

  // Divider
  h.push('<tr><td style="padding:0 36px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td height="1" bgcolor="#E5E5EA" style="background-color:#E5E5EA;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>');

  // ── Payment methods ──────────────────────────────────────────
  h.push('<tr><td style="padding:20px 36px;">');
  h.push('<div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#16161B;margin-bottom:14px;">Payment Methods</div>');
  h.push(buildPaymentSection_(region));
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
  // Shown below the main header/detail rows.
  function discRow(label, std, disc, net, discType, discVal) {
    var discStr = fmtDiscount_(discType, discVal, currency);
    var stdCell = (parseFloat(discVal) || 0) > 0
      ? '<td ' + tdStrike + '>' + fmtCurrency_(std, currency) + '</td>'
      : '<td ' + tdR      + '>' + fmtCurrency_(std, currency) + '</td>';
    return '<tr>' +
      '<td ' + tdStyle + '>' + escapeHtml_(label) + '</td>' +
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
  // PD session row
  if (pdSession && di.pdStd > 0) {
    h.push(discRow('PD — ' + pdSession, di.pdStd, di.pdStd - di.pdNet, di.pdNet, di.pdType, di.pdVal));
  }

  h.push('</tbody>');

  // Total footer
  var stdTotalFmt = di.totalStd > 0 ? fmtCurrency_(di.totalStd, currency) : '';
  var netTotalFmt = di.totalNet > 0 ? fmtCurrency_(di.totalNet, currency) : escapeHtml_(grandTotal);
  var stdTotalCell = (hasDiscount && di.totalStd > 0)
    ? '<td ' + tdStrike + '>' + stdTotalFmt + '</td>'
    : '<td style="padding:10px 12px;text-align:right;border-top:2px solid #E5E5EA;"></td>';
  h.push('<tfoot><tr>');
  h.push('<td style="font-size:12px;font-weight:700;color:#555;padding:10px 12px;border-top:2px solid #E5E5EA;">Total</td>');
  h.push(stdTotalCell);
  h.push('<td style="padding:10px 12px;text-align:right;border-top:2px solid #E5E5EA;"></td>');
  h.push('<td style="font-size:14px;font-weight:800;color:#16161B;padding:10px 12px;text-align:right;border-top:2px solid #E5E5EA;">' + netTotalFmt + '</td>');
  h.push('</tr></tfoot>');
  h.push('</table></td></tr>');

  h.push('</table>');
  return h.join('');
}

/** Payment methods section — two-column card layout, region-specific. */
function buildPaymentSection_(region) {
  var preferred = '<td width="48%" bgcolor="#EBE9FF" style="background-color:#EBE9FF;border-radius:6px;padding:14px 16px;font-size:12px;color:#555;line-height:1.6;vertical-align:top;">' +
    '<div style="font-size:12px;font-weight:700;color:#16161B;margin-bottom:6px;">Credit Card or PayPal ' +
    '<span style="background-color:#6551FF;color:#FDFDFE;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;letter-spacing:0.5px;">PREFERRED</span></div>' +
    'Log into your Soundtrap education subscription and click <strong>Buy Now</strong>. Accepts Visa, Mastercard, and PayPal.' +
    '</td>';

  var invoiceTitle, invoiceBody;
  if (region === 'US') {
    invoiceTitle = 'Invoice \u2014 ACH, Wire Transfer, or Check';
    invoiceBody  = '<strong>Not available for Classroom Plans.</strong> Submit via <a href="https://soundtrap.me/order_form" style="color:#6551FF;">soundtrap.me/order_form</a>. Include PO if required. Invoices emailed within 7 business days (Net-30).';
  } else if (region === 'Canada') {
    invoiceTitle = 'Invoice \u2014 Wire Transfer';
    invoiceBody  = '<strong>Not available for Classroom Plans.</strong> Submit via <a href="https://soundtrap.me/order_form" style="color:#6551FF;">soundtrap.me/order_form</a>. Include PO if required. Invoices emailed within 7 business days (Net-30).';
  } else {
    invoiceTitle = 'Invoice \u2014 International Bank Transfer';
    invoiceBody  = 'Submit via <a href="https://soundtrap.me/order_form" style="color:#6551FF;">soundtrap.me/order_form</a>. Contact your sales representative for bank details and applicable taxes.';
  }

  var invoice = '<td width="48%" bgcolor="#F5F3FF" style="background-color:#F5F3FF;border-radius:6px;padding:14px 16px;font-size:12px;color:#555;line-height:1.6;vertical-align:top;">' +
    '<div style="font-size:12px;font-weight:700;color:#16161B;margin-bottom:6px;">' + invoiceTitle + '</div>' +
    invoiceBody + '</td>';

  return '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    preferred + '<td width="4%"></td>' + invoice +
    '</tr></table>';
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
    QuoteToState:            data.state   || '',
    QuoteToCountry:          data.country || '',
    Subscription_Length_Months__c: parseInt(data.subscription_length || 0, 10) || null,
    Requested_At__c:         Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssZ"),
    ExpirationDate:          Utilities.formatDate(addDays_(timestamp, QUOTE_VALID_DAYS), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
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
  }

  // ── Fee calculations ─────────────────────────────────────────
  var months  = parseInt(data.subscription_length || 12, 10);
  var schools = parseInt(data.number_of_schools   || 0,  10);
  var pdFee   = data.pd_session ? (PD_PRICES[data.pd_session] || 0) : 0;

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
  var c = (country || '').toLowerCase();
  if (c === 'united states') return 'US';
  if (c === 'canada')        return 'Canada';
  if (c === 'australia' || c === 'new zealand') return 'ANZ';
  return 'ROW';
}

/** Map a country string to its currency code. */
function currencyForCountry_(country) {
  var EUROZONE = ['Austria','Belgium','Croatia','Cyprus','Estonia','Finland','France',
    'Germany','Greece','Ireland','Italy','Latvia','Lithuania','Luxembourg','Malta',
    'Netherlands','Portugal','Slovakia','Slovenia','Spain'];
  var map = {
    'United States': 'USD', 'United Kingdom': 'GBP',
    'Sweden': 'SEK', 'Norway': 'NOK', 'Canada': 'CAD', 'Australia': 'AUD',
  };
  if (map[country]) return map[country];
  if (EUROZONE.indexOf(country) !== -1) return 'EUR';
  return 'USD';
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

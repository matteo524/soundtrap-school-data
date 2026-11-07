/**
 * ============================================================
 *  Soundtrap for Education — Privacy & Legal Documents form
 *  Google Apps Script backend (form v2, Nov 2026)
 * ============================================================
 *
 *  What a submission can ask for (payload.needs):
 *    vpat      — our VPAT                     → emailed automatically, nobody notified
 *    standard  — a copy of the standard NDPA / DPA / PUB-avtal
 *                                            → emailed automatically, rep gets an FYI
 *    exhibitE  — join an existing US state agreement (Exhibit E)
 *    signed    — return a signed standard agreement
 *    review    — review of the customer's own documents
 *                                            → rep notified, contracts@ in CC
 *
 *  SETUP
 *  1. Script Properties (Project Settings → Script Properties):
 *       DOC_ID_VPAT       Drive file ID of the VPAT
 *       DOC_ID_NDPA       Drive file ID of the standard NDPA (US)
 *       DOC_ID_DPA        Drive file ID of the standard DPA (rest of world)
 *       DOC_ID_PUB_AVTAL  Drive file ID of the standard PUB-avtal (Sweden)
 *       SLACK_WEBHOOK_URL (optional) Incoming Webhook for notifications
 *     Google Docs are sent as PDF; PDFs and Word files are sent as they are.
 *     To change a document, point its property at a new file. No redeploy needed.
 *  2. Run initSheet() once to create the "Legal Requests v2" tab.
 *  3. Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone),
 *     then paste the URL into LF_CONFIG.appsScriptUrl in legal-form.html.
 * ============================================================
 */

// ── Configuration ────────────────────────────────────────────
var SHEET_ID        = '1B5dWNG9FwX8EkHJjWbtoidOityOmUbXk9wnM5urYSpA';
var DRIVE_FOLDER_ID = '1rE-s08iV9JyIo5R_k6S_lmelR9GTsqOk';
var SHEET_TAB_NAME  = 'Legal Requests v2';   // v1 rows stay in "Legal Requests"
var CONTRACTS_EMAIL = 'contracts@soundtrap.com';
var FROM_NAME       = 'Soundtrap for Education';

var BUSINESS_DAYS_AGREEMENT = 5;    // Exhibit E + signed standard agreements
var BUSINESS_DAYS_REVIEW    = 10;   // custom review ("at least 2 weeks")

/** Documents sent automatically. Keys match payload.standardAgreement + 'vpat'. */
var AUTO_DOCS = {
  'vpat':      { prop: 'DOC_ID_VPAT',      fileName: 'Soundtrap VPAT.pdf',          label: 'Soundtrap VPAT (accessibility report)' },
  'NDPA':      { prop: 'DOC_ID_NDPA',      fileName: 'Soundtrap NDPA.pdf',          label: 'Soundtrap standard NDPA' },
  'DPA':       { prop: 'DOC_ID_DPA',       fileName: 'Soundtrap DPA.pdf',           label: 'Soundtrap standard DPA' },
  'PUB-avtal': { prop: 'DOC_ID_PUB_AVTAL', fileName: 'Soundtrap PUB-avtal.pdf',     label: 'Soundtrap standard PUB-avtal' },
};

var NEED_LABELS = {
  vpat:     'VPAT',
  standard: 'Standard agreement copy',
  exhibitE: 'Exhibit E',
  signed:   'Signed agreement returned',
  review:   'Document review',
};

// ── Sheet columns (written by header name) ───────────────────
var COLUMNS = [
  'Timestamp', 'Status', 'Due By',
  'Needs', 'Standard Agreement', 'Exhibit E State',
  'Country', 'State', 'City', 'District / Organization', 'School', 'NCES', 'Manual Entry',
  'Purchase Stage', 'Seats', 'Order Method', 'Reseller Name',
  'Summary', 'Needed By',
  'First Name', 'Last Name', 'Email', 'Role', 'Role Other',
  'Breach Contact Name', 'Breach Contact Email',
  'File URLs', 'Documents Sent', 'Document Errors',
  'Sales Rep Name', 'Sales Rep Email', 'Sales Rep Pod',
];

// ── Shared config (single source of truth) ───────────────────
var CONFIG_URL               = 'https://matteo524.github.io/soundtrap-school-data/config/config.json';
var CONFIG_CACHE_KEY         = 'SHARED_CONFIG_v1';
var CONFIG_CACHE_TTL_SECONDS = 600;
var _configMemo = null;

function loadConfig_() {
  if (_configMemo) return _configMemo;
  try {
    var cached = CacheService.getScriptCache().get(CONFIG_CACHE_KEY);
    if (cached) { _configMemo = JSON.parse(cached); return _configMemo; }
  } catch (_e) { /* fall through */ }

  var resp = UrlFetchApp.fetch(CONFIG_URL, { muteHttpExceptions: true, headers: { 'Cache-Control': 'no-cache' } });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Failed to load shared config from ' + CONFIG_URL + ' — HTTP ' + resp.getResponseCode());
  }
  var text = resp.getContentText();
  _configMemo = JSON.parse(text);
  try { CacheService.getScriptCache().put(CONFIG_CACHE_KEY, text, CONFIG_CACHE_TTL_SECONDS); } catch (_e) {}
  return _configMemo;
}

/** Assigned sales rep from country / state / district / email (same rules as v1). */
function computeTerritory(country, state, district, email) {
  var T = loadConfig_().territory;
  var stateLc = (state || '').toLowerCase();
  var districtLc = (district || '').toLowerCase();
  var emailDomain = (email || '').indexOf('@') !== -1 ? email.split('@')[1].toLowerCase() : '';
  var pod;

  if (country === 'United States') {
    if (districtLc && T.usNamed2 && T.usNamed2.indexOf(districtLc) !== -1) {
      pod = 'US Named Accounts 2';
    } else if (districtLc && (T.usNamed.indexOf(districtLc) !== -1 ||
        districtLc.indexOf('new york city geographic district') === 0)) {
      pod = 'US Named Accounts';
    } else {
      pod = T.statePod[stateLc] || 'Scaled Accounts';
    }
  } else if (country === 'Canada') {
    pod = 'Canada';
  } else if (country === 'United Kingdom') {
    pod = 'UK';
  } else if (country) {
    pod = (emailDomain && T.rowNamedDomains.indexOf(emailDomain) !== -1) ? 'ROW Named Accounts' : 'ROW';
  } else {
    pod = '';
  }
  var repData = pod ? (T.podRep[pod] || {}) : {};
  return { pod: pod || '', rep: repData.name || '', email: repData.email || '' };
}

// ─────────────────────────────────────────────────────────────
//  HTTP handlers
// ─────────────────────────────────────────────────────────────

function doGet(e) {
  return jsonResponse({ success: true, message: 'Legal Form API v2' });
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.formVersion !== 2) {
      throw new Error('Unsupported form version. Please refresh the page and try again.');
    }
    data.needs = (data.needs || []).filter(function (k) { return NEED_LABELS[k]; });
    if (!data.needs.length) throw new Error('No request type selected.');
    if (!data.email) throw new Error('Email is required.');

    var needs = data.needs;
    var agreementOnly = needs.every(function (k) { return k === 'vpat' || k === 'standard'; });

    // 1. Uploaded files → Drive
    var fileUrls = saveFiles(data.files || [], data);

    // 2. Territory
    var territory = computeTerritory(data.country || '', data.state || '', data.district || '', data.email || '');

    // 3. Documents to send automatically
    var docs = collectAutoDocs_(data);

    // 4. Sheet
    var dueBy = dueDate_(needs);
    writeToSheet(data, fileUrls, territory, docs, dueBy);

    // 5. Customer email (with attachments)
    sendConfirmation(data, fileUrls, docs);

    // 6. Internal notifications (VPAT-only requests notify nobody)
    var internalNeeded = needs.some(function (k) { return k !== 'vpat'; });
    if (internalNeeded) {
      sendInternalNotification(data, fileUrls, territory, docs, dueBy, agreementOnly);
      try { sendSlackNotification_(data, fileUrls, territory, dueBy); } catch (_s) { /* best-effort */ }
    }
    if (docs.errors.length) sendDocErrorAlert_(data, docs);

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────
//  Automatic documents
// ─────────────────────────────────────────────────────────────

/** Returns { blobs: [Blob], labels: [string], errors: [string] } for the requested documents. */
function collectAutoDocs_(data) {
  var keys = [];
  if (data.needs.indexOf('vpat') !== -1) keys.push('vpat');
  if (data.needs.indexOf('standard') !== -1 && AUTO_DOCS[data.standardAgreement]) keys.push(data.standardAgreement);

  var props = PropertiesService.getScriptProperties();
  var out = { blobs: [], labels: [], errors: [] };
  keys.forEach(function (k) {
    var doc = AUTO_DOCS[k];
    try {
      var id = props.getProperty(doc.prop);
      if (!id) throw new Error('Script Property ' + doc.prop + ' is not set');
      out.blobs.push(fileAsAttachment_(id, doc.fileName));
      out.labels.push(doc.label);
    } catch (err) {
      out.errors.push(doc.label + ': ' + err.message);
    }
  });
  return out;
}

/** Google Docs → PDF; anything else is attached as-is. */
function fileAsAttachment_(fileId, fileName) {
  var file = DriveApp.getFileById(fileId);
  var mime = file.getMimeType();
  if (mime === MimeType.GOOGLE_DOCS) return file.getAs(MimeType.PDF).setName(fileName);
  var blob = file.getBlob();
  if (mime !== MimeType.PDF) return blob.setName(file.getName());
  return blob.setName(fileName);
}

/** Checks every document property resolves to a readable file. Run manually from the editor. */
function checkDocuments() {
  var props = PropertiesService.getScriptProperties();
  Object.keys(AUTO_DOCS).forEach(function (k) {
    var doc = AUTO_DOCS[k];
    var id = props.getProperty(doc.prop);
    if (!id) { Logger.log('✗ ' + doc.prop + ' is not set'); return; }
    try {
      var f = DriveApp.getFileById(id);
      var b = fileAsAttachment_(id, doc.fileName);
      Logger.log('✓ ' + doc.prop + ' → "' + f.getName() + '" (sent as ' + b.getName() + ', ' + Math.round(b.getBytes().length / 1024) + ' KB)');
    } catch (err) {
      Logger.log('✗ ' + doc.prop + ' (' + id + '): ' + err.message);
    }
  });
}

// ─────────────────────────────────────────────────────────────
//  Sheet
// ─────────────────────────────────────────────────────────────

function getSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_TAB_NAME);
    sheet.appendRow(COLUMNS);
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function writeToSheet(data, fileUrls, territory, docs, dueBy) {
  var needs = data.needs;
  var actionable = needs.some(function (k) { return k === 'exhibitE' || k === 'signed' || k === 'review'; });
  var row = {
    'Timestamp':               new Date(),
    'Status':                  actionable ? 'New' : (docs.errors.length ? 'Send manually' : 'Sent automatically'),
    'Due By':                  dueBy || '',
    'Needs':                   needs.map(function (k) { return NEED_LABELS[k]; }).join(', '),
    'Standard Agreement':      data.standardAgreement || '',
    'Exhibit E State':         data.exhibitEState || '',
    'Country':                 data.country || '',
    'State':                   data.state || '',
    'City':                    data.city || '',
    'District / Organization': data.district || '',
    'School':                  data.school || '',
    'NCES':                    data.nces || '',
    'Manual Entry':            data.manualEntry || '',
    'Purchase Stage':          data.purchaseStage || '',
    'Seats':                   data.seats || '',
    'Order Method':            data.orderMethod || '',
    'Reseller Name':           data.resellerName || '',
    'Summary':                 data.summary || '',
    'Needed By':               data.neededBy || '',
    'First Name':              data.firstName || '',
    'Last Name':               data.lastName || '',
    'Email':                   data.email || '',
    'Role':                    data.role || '',
    'Role Other':              data.roleOther || '',
    'Breach Contact Name':     data.breachContactName || '',
    'Breach Contact Email':    data.breachContactEmail || '',
    'File URLs':               fileUrls.join('\n'),
    'Documents Sent':          docs.labels.join(', '),
    'Document Errors':         docs.errors.join('\n'),
    'Sales Rep Name':          territory.rep || '',
    'Sales Rep Email':         territory.email || '',
    'Sales Rep Pod':           territory.pod || '',
  };
  var sheet = getSheet();
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(headers.map(function (h) { return row.hasOwnProperty(h) ? row[h] : ''; }));
}

function initSheet() {
  getSheet();
  Logger.log('Sheet ready: ' + SHEET_TAB_NAME);
}

// ─────────────────────────────────────────────────────────────
//  Drive (uploaded files)
// ─────────────────────────────────────────────────────────────

function saveFiles(files, data) {
  if (!files || !files.length) return [];
  var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  var prefix = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') +
               ' - ' + (data.district || data.school || data.email || 'request') + ' - ';
  var urls = [];
  files.forEach(function (f) {
    try {
      var blob = Utilities.newBlob(Utilities.base64Decode(f.data), f.type || 'application/octet-stream',
                                   prefix + (f.name || 'attachment'));
      var file = folder.createFile(blob);
      // Signed agreements can contain personal data: share inside soundtrap.com only.
      try { file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); } catch (_e) {}
      urls.push(file.getUrl());
    } catch (err) {
      Logger.log('File save error: ' + err.message);
    }
  });
  return urls;
}

// ─────────────────────────────────────────────────────────────
//  Email: customer confirmation (+ attached documents)
// ─────────────────────────────────────────────────────────────

function sendConfirmation(data, fileUrls, docs) {
  var needs = data.needs;
  var instantOnly = needs.every(function (k) { return k === 'vpat' || k === 'standard'; });
  var subject = instantOnly ? 'Your Soundtrap documents' : 'We’ve received your request — Soundtrap for Education';

  var attachedLine = docs.labels.length
    ? '<p>Attached to this email: <strong>' + docs.labels.map(escHtml).join('</strong> and <strong>') + '</strong>.</p>'
    : '';
  var missingLine = docs.errors.length
    ? '<p>We couldn’t attach every document automatically. Our contracts team will send the rest to you shortly.</p>'
    : '';

  var body = emailShell_(
    '<p>Hi ' + escHtml(data.firstName || 'there') + ',</p>' +
    '<p>Thank you for your request' + (orgName_(data) ? ' for <strong>' + escHtml(orgName_(data)) + '</strong>' : '') + '.</p>' +
    attachedLine + missingLine +
    '<h3 style="color:#6551F2;margin:24px 0 8px;">What happens next</h3>' +
    '<ul style="padding-left:18px;margin:0;">' + nextStepsHtml_(data) + '</ul>' +
    (fileUrls.length ? '<p style="margin-top:16px;font-size:13px;color:#555;">We received ' + fileUrls.length + ' uploaded document(s).</p>' : '') +
    '<p style="margin-top:24px;font-size:13px;color:#555;">Questions? Just reply to this email or write to ' +
    '<a href="mailto:' + CONTRACTS_EMAIL + '">' + CONTRACTS_EMAIL + '</a>.</p>'
  );

  MailApp.sendEmail({
    to:          data.email,
    subject:     subject,
    htmlBody:    body,
    name:        FROM_NAME,
    replyTo:     CONTRACTS_EMAIL,
    attachments: docs.blobs,
  });
}

function nextStepsHtml_(data) {
  var n = data.needs, items = [];
  var ag = data.standardAgreement || 'agreement';
  if (n.indexOf('exhibitE') !== -1) items.push('<strong>Exhibit E' + (data.exhibitEState ? ' (' + escHtml(data.exhibitEState) + ')' : '') + ':</strong> once we receive your signed Exhibit E, we countersign it and email it back within <strong>5 business days</strong>. If you haven’t uploaded it yet, sign it through the SDPC Resource Registry or reply to this email with the signed copy.');
  if (n.indexOf('standard') !== -1) items.push('<strong>Standard ' + escHtml(ag) + ':</strong> attached. When it’s signed, return it through the same form (choose “Return a signed agreement”) and we’ll countersign it within 5 business days.');
  if (n.indexOf('signed')   !== -1) items.push('<strong>Signed agreement:</strong> we countersign it and email you the fully signed copy within <strong>5 business days</strong>.');
  if (n.indexOf('review')   !== -1) items.push('<strong>Document review:</strong> our contracts team will reply within <strong>2 weeks</strong>. Several documents, or long and complex ones, can take longer; we’ll let you know if so.');
  if (n.indexOf('vpat')     !== -1) items.push('<strong>VPAT:</strong> attached.');
  return items.map(function (s) { return '<li style="margin-bottom:8px;">' + s + '</li>'; }).join('');
}

// ─────────────────────────────────────────────────────────────
//  Email: internal notification (rep, + contracts@ when action is needed)
// ─────────────────────────────────────────────────────────────

function sendInternalNotification(data, fileUrls, territory, docs, dueBy, agreementOnly) {
  var repEmail = territory.email || '';
  var to = repEmail || CONTRACTS_EMAIL;
  var cc = (!agreementOnly && to !== CONTRACTS_EMAIL) ? CONTRACTS_EMAIL : '';

  var needLabels = data.needs.map(function (k) { return NEED_LABELS[k]; });
  var where = data.state || data.country || '';
  var subject = (agreementOnly ? 'FYI: standard ' + (data.standardAgreement || 'agreement') + ' requested' : 'Legal request: ' + needLabels.join(', ')) +
                ' — ' + (orgName_(data) || 'Unknown organization') + (where ? ' (' + where + ')' : '');

  var intro = agreementOnly
    ? '<p>A customer in your territory requested our standard <strong>' + escHtml(data.standardAgreement) +
      '</strong>. No action is needed from contracts; this is a heads-up for the account.</p>'
    : '<p><strong>Action needed by contracts.</strong> Due by <strong>' + escHtml(dueBy) + '</strong>.</p>';

  var fileList = fileUrls.length
    ? '<h3 style="color:#6551F2;">Uploaded documents</h3><ul>' +
      fileUrls.map(function (u) { return '<li><a href="' + u + '">' + u + '</a></li>'; }).join('') + '</ul>'
    : '';

  var body = emailShell_(
    intro +
    '<h3 style="color:#6551F2;margin-top:16px;">Request</h3>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
    tr('Needs',              escHtml(needLabels.join(', '))) +
    tr('Standard agreement', escHtml(data.standardAgreement)) +
    tr('Exhibit E state',    escHtml(data.exhibitEState)) +
    tr('Needed by',          escHtml(data.neededBy)) +
    tr('Summary',            escHtml(data.summary).replace(/\n/g, '<br>')) +
    tr('Docs sent',          escHtml(docs.labels.join(', '))) +
    '</table>' +
    '<h3 style="color:#6551F2;margin-top:16px;">Organization</h3>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
    tr('District / organization', escHtml(data.district)) +
    tr('School',            escHtml(data.school)) +
    tr('City',              escHtml(data.city)) +
    tr('State',             escHtml(data.state)) +
    tr('Country',           escHtml(data.country)) +
    tr('NCES',              escHtml(data.nces)) +
    tr('Manual entry',      escHtml(data.manualEntry)) +
    tr('Purchase stage',    escHtml(data.purchaseStage)) +
    tr('Seats',             escHtml(data.seats)) +
    tr('Order method',      escHtml(data.orderMethod)) +
    tr('Reseller',          escHtml(data.resellerName)) +
    tr('Sales rep',         escHtml(territory.rep ? territory.rep + ' (' + territory.pod + ')' : 'No rep matched')) +
    '</table>' +
    '<h3 style="color:#6551F2;margin-top:16px;">Contact</h3>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
    tr('Name',  escHtml((data.firstName || '') + ' ' + (data.lastName || ''))) +
    tr('Email', '<a href="mailto:' + escHtml(data.email) + '">' + escHtml(data.email) + '</a>') +
    tr('Role',  escHtml(data.role) + (data.roleOther ? ' — ' + escHtml(data.roleOther) : '')) +
    (data.breachContactEmail ? tr('Breach contact', escHtml(data.breachContactName) + ' &lt;' + escHtml(data.breachContactEmail) + '&gt;') : '') +
    '</table>' +
    fileList +
    '<p style="margin-top:20px;font-size:12px;color:#888;">Logged in the <a href="https://docs.google.com/spreadsheets/d/' + SHEET_ID +
    '">Legal Requests sheet</a> (tab “' + SHEET_TAB_NAME + '”). Reply to this email to reach the customer.</p>'
  );

  var opts = { to: to, subject: subject, htmlBody: body, name: FROM_NAME + ' Legal Form', replyTo: data.email };
  if (cc) opts.cc = cc;
  MailApp.sendEmail(opts);
}

/** Tells contracts@ when an automatic document could not be attached, so they send it by hand. */
function sendDocErrorAlert_(data, docs) {
  MailApp.sendEmail({
    to:       CONTRACTS_EMAIL,
    subject:  'Please send manually: ' + docs.errors.length + ' document(s) for ' + (data.email || 'unknown'),
    htmlBody: emailShell_(
      '<p>The legal form could not attach these documents automatically:</p><ul>' +
      docs.errors.map(function (e) { return '<li>' + escHtml(e) + '</li>'; }).join('') + '</ul>' +
      '<p>Please send them to <a href="mailto:' + escHtml(data.email) + '">' + escHtml(data.email) + '</a> ' +
      '(' + escHtml((data.firstName || '') + ' ' + (data.lastName || '')) + ', ' + escHtml(orgName_(data) || data.country) + ').</p>' +
      '<p>To fix it for future requests, check the DOC_ID_* Script Properties and run <code>checkDocuments()</code> in the Apps Script editor.</p>'
    ),
    name: FROM_NAME + ' Legal Form',
  });
}

// ─────────────────────────────────────────────────────────────
//  Slack
// ─────────────────────────────────────────────────────────────

function sendSlackNotification_(data, fileUrls, territory, dueBy) {
  var webhookUrl = '';
  try { webhookUrl = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL') || ''; } catch (_e) { return; }
  if (!webhookUrl) return;

  var lines = [
    'Hello, *' + (territory.rep || 'Legal Team') + '*',
    '',
    'A new legal request has been submitted in your territory',
    '<https://docs.google.com/spreadsheets/d/' + SHEET_ID + '|View in Legal Requests sheet>',
    '',
    '*Needs:* ' + data.needs.map(function (k) { return NEED_LABELS[k]; }).join(', ') +
      (data.standardAgreement ? ' (standard: ' + data.standardAgreement + ')' : ''),
    '*School / District:* ' + (orgName_(data) || '—'),
    '*Country / State:* ' + [data.country, data.state].filter(Boolean).join(' / '),
    '*Purchase stage:* ' + (data.purchaseStage || '—'),
    dueBy ? '*Due by:* ' + dueBy : '',
    '*Requested by:* ' + ((data.firstName || '') + ' ' + (data.lastName || '')).trim() + ' (' + (data.email || '') + ')',
    data.summary ? '*Comments:* ' + data.summary : '',
    fileUrls.length ? '*Attachments:* ' + fileUrls.length + ' file(s)' : '',
  ];
  UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text: lines.filter(function (l, i) { return l !== '' || i === 1 || i === 4; }).join('\n') }),
    muteHttpExceptions: true,
  });
}

// ─────────────────────────────────────────────────────────────
//  Utilities
// ─────────────────────────────────────────────────────────────

function orgName_(data) {
  return [data.school, data.district].filter(Boolean).join(', ');
}

/** SLA due date for the request, or '' when nothing needs action. */
function dueDate_(needs) {
  var days = 0;
  if (needs.indexOf('exhibitE') !== -1 || needs.indexOf('signed') !== -1) days = BUSINESS_DAYS_AGREEMENT;
  if (needs.indexOf('review') !== -1) days = BUSINESS_DAYS_REVIEW;
  if (!days) return '';
  var d = new Date();
  while (days > 0) {
    d.setDate(d.getDate() + 1);
    var dow = d.getDay();
    if (dow !== 0 && dow !== 6) days--;
  }
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function emailShell_(inner) {
  return '<div style="font-family:Helvetica Neue,Helvetica,Arial,sans-serif;max-width:640px;color:#161616;font-size:14px;line-height:1.5;">' +
    '<div style="background:#161616;padding:22px 30px;border-radius:8px 8px 0 0;border-top:4px solid #6551F2;">' +
    '<p style="color:#FDFDF5;font-size:20px;font-weight:700;margin:0;">Soundtrap for Education</p>' +
    '</div>' +
    '<div style="background:#FDFDF5;padding:26px 30px;border-radius:0 0 8px 8px;">' + inner + '</div></div>';
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Two-column table row for email HTML; skipped when the value is empty. */
function tr(label, value) {
  if (!value && value !== 0) return '';
  return '<tr>' +
    '<td style="padding:5px 8px;border:1px solid #E8E5F5;font-weight:600;white-space:nowrap;background:#F4F4F5;">' + label + '</td>' +
    '<td style="padding:5px 8px;border:1px solid #E8E5F5;">' + value + '</td>' +
    '</tr>';
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * ============================================================
 *  Soundtrap for Education — Legal & Agreement Request Form
 *  Google Apps Script backend
 * ============================================================
 *
 *  SETUP (one-time):
 *  1. Create a new Google Sheet. Copy its ID from the URL
 *     (the string between /d/ and /edit) → paste into SHEET_ID.
 *  2. Create a Google Drive folder for uploaded files. Copy its
 *     ID from the URL → paste into DRIVE_FOLDER_ID.
 *  3. Run initSheet() once manually to create the header row.
 *  4. Deploy → New deployment → Web app:
 *       Execute as: Me
 *       Who has access: Anyone
 *  5. Copy the deployment URL → paste into LF_CONFIG.appsScriptUrl
 *     in legal-form.html.
 * ============================================================
 */

// ── Configuration ────────────────────────────────────────────
var SHEET_ID         = '1B5dWNG9FwX8EkHJjWbtoidOityOmUbXk9wnM5urYSpA';
var DRIVE_FOLDER_ID  = '1rE-s08iV9JyIo5R_k6S_lmelR9GTsqOk';
var SHEET_TAB_NAME   = 'Legal Requests';
var FALLBACK_EMAIL   = 'legal@soundtrap.com'; // catches submissions with no matched rep

// ── Sheet column headers (order must match appendRow call) ───
var COLUMNS = [
  'Timestamp',
  'Request Type', 'VPAT Requested',
  'Country', 'State', 'City', 'District', 'School', 'Manual Entry',
  'Order Placed', 'Seats', 'Order Method', 'Reseller Name',
  'NDPA', 'Exhibit E', 'Pub-Avtal', 'DPA',
  'Summary',
  'First Name', 'Last Name', 'Email',
  'Role', 'Role Other',
  'Breach Contact Name', 'Breach Contact Email',
  'Purchase Date',
  'File URLs',
  'Sales Rep Name', 'Sales Rep Email', 'Sales Rep Pod',
];

// ── Territory data (mirrors legal-form.html) ─────────────────
var TERRITORY = {
  statePod: {
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
  },
  podRep: {
    'Scaled Accounts':    { name: 'The Soundtrap Team',  email: 'orders@soundtrap.com'    },
    'Northwest':          { name: 'Brittany Follet',      email: 'brittany@soundtrap.com'  },
    'Southwest':          { name: 'Maria Opirhory',       email: 'maria@soundtrap.com'     },
    'Central':            { name: 'Chloe Taylor',         email: 'chloe@soundtrap.com'     },
    'Northeast':          { name: 'Chad Reisfelt',       email: 'chad@soundtrap.com'   },
    'Southeast':          { name: 'Tina Shah',            email: 'tina@soundtrap.com'      },
    'Canada':             { name: 'Chad Reisfelt',        email: 'chad@soundtrap.com'      },
    'UK':                 { name: 'Michael Beardsley',    email: 'michael@soundtrap.com'  },
    'ROW':                { name: 'Jennifer Meehleis',    email: 'jennifer@soundtrap.com'  },
    'US Named Accounts':  { name: 'Leandro Otero',        email: 'leandro@soundtrap.com'   },
    'ROW Named Accounts': { name: 'Angelica Johansson',   email: 'angelicaj@soundtrap.com' },
  },
  usNamed: [
    'los angeles unified','san francisco unified',
    'jefferson county school district no. r-1','district of columbia public schools',
    'polk','broward','duval','miami-dade','orange','hillsborough',
    'palm beach','hawaii department of education',
    'chicago public schools dist 299','montgomery county public schools',
    'baltimore county public schools',"prince george's county public schools",
    'lincoln public schools','clark county','wake county schools',
    'charlotte-mecklenburg schools','philadelphia city sd',
    'puerto rico department of education','memphis-shelby county schools',
    'dallas isd','houston isd','fairfax county public schools',
  ],
  rowNamedDomains: [
    'solvesborg.se','simrishamn.se','educacio.ad','govern.ad','goteborg.se',
    'engelska.se','ale.se','kunskapsskolan.se','bollebygd.se','trondheim.kommune.no',
    'kalmar.se','dodea.edu','marks.se','ecolint.ch','stavanger.kommune.no',
    'stpeters.vic.edu.au','stenungsund.se','sola.kommune.no','varberg.se',
    'larvik.kommune.no','askoy.kommune.no','vastervik.se','fredrikstad.kommune.no',
    'kungalv.se','pacifichills.nsw.edu.au','alingsas.se','stmonicas.vic.edu.au',
    'makemusicmatter.org','sandnes.kommune.no','hudiksvall.se','mlc.vic.edu.au',
    'angelholm.se','boras.se','ullensaker.kommune.no','orebro.se',
    'watmaeducation.com','edu.laroverken.se','edu.nordicinternational.se',
    'edu.kronobergskola.se','krono.se','bs.ch',
  ],
};

/**
 * Compute the assigned sales rep from country / state / district / email.
 * @param {string} country
 * @param {string} state
 * @param {string} district
 * @param {string} email
 * @return {{ pod:string, rep:string, email:string }}
 */
function computeTerritory(country, state, district, email) {
  var stateLc    = (state    || '').toLowerCase();
  var districtLc = (district || '').toLowerCase();
  var emailDomain = (email || '').indexOf('@') !== -1 ? email.split('@')[1].toLowerCase() : '';

  var pod;

  if (country === 'United States') {
    if (districtLc && (TERRITORY.usNamed.indexOf(districtLc) !== -1 ||
        districtLc.indexOf('new york city geographic district') === 0)) {
      pod = 'US Named Accounts';
    } else {
      pod = TERRITORY.statePod[stateLc] || 'Scaled Accounts';
    }
  } else if (country === 'Canada') {
    pod = 'Canada';
  } else if (country === 'United Kingdom') {
    pod = 'UK';
  } else if (country) {
    pod = (emailDomain && TERRITORY.rowNamedDomains.indexOf(emailDomain) !== -1)
      ? 'ROW Named Accounts' : 'ROW';
  } else {
    pod = '';
  }

  var repData = pod ? (TERRITORY.podRep[pod] || {}) : {};
  return { pod: pod || '', rep: repData.name || '', email: repData.email || '' };
}

// ─────────────────────────────────────────────────────────────
//  HTTP handlers
// ─────────────────────────────────────────────────────────────

function doGet(e) {
  var out = ContentService.createTextOutput(
    JSON.stringify({ success: true, message: 'Legal Form API' })
  );
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // 1. Save uploaded files to Drive
    var fileUrls = saveFiles(data.files || []);

    // 2. Compute territory
    var territory = computeTerritory(
      data.country   || '',
      data.state     || '',
      data.district  || '',
      data.email     || ''
    );

    // 3. Append row to Sheet
    writeToSheet(data, fileUrls, territory);

    // 4. Send emails
    sendConfirmation(data, fileUrls, territory);
    sendRepNotification(data, fileUrls, territory);

    return jsonResponse({ success: true });

  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────
//  Sheet helpers
// ─────────────────────────────────────────────────────────────

function getSheet() {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_TAB_NAME);
    sheet.appendRow(COLUMNS);
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function writeToSheet(data, fileUrls, territory) {
  var sheet = getSheet();
  sheet.appendRow([
    new Date(),                   // Timestamp
    data.requestType   || '',     // Request Type
    data.vpatRequested || 'No',   // VPAT Requested
    data.country       || '',     // Country
    data.state         || '',     // State
    data.city          || '',     // City
    data.district      || '',     // District
    data.school        || '',     // School
    data.manualEntry   || '',     // Manual Entry
    data.orderPlaced   || '',     // Order Placed
    data.seats         || '',     // Seats
    data.orderMethod   || '',     // Order Method
    data.resellerName  || '',     // Reseller Name
    data.ndpa          || '',     // NDPA
    data.exhibitE      || '',     // Exhibit E
    data.pubAvtal      || '',     // Pub-Avtal
    data.dpa           || '',     // DPA
    data.summary       || '',     // Summary
    data.firstName     || '',     // First Name
    data.lastName      || '',     // Last Name
    data.email         || '',     // Email
    data.role          || '',     // Role
    data.roleOther     || '',     // Role Other
    data.breachContactName  || '', // Breach Contact Name
    data.breachContactEmail || '', // Breach Contact Email
    data.purchaseDate  || '',     // Purchase Date
    fileUrls.join('\n'),          // File URLs
    territory.rep      || '',     // Sales Rep Name
    territory.email    || '',     // Sales Rep Email
    territory.pod      || '',     // Sales Rep Pod
  ]);
}

// ── One-time setup ───────────────────────────────────────────
function initSheet() {
  getSheet();
  Logger.log('Sheet initialised: ' + SHEET_TAB_NAME);
}

// ─────────────────────────────────────────────────────────────
//  Drive file saving
// ─────────────────────────────────────────────────────────────

function saveFiles(files) {
  if (!files || !files.length) return [];
  var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  var urls   = [];

  files.forEach(function(f) {
    try {
      var blob = Utilities.newBlob(
        Utilities.base64Decode(f.data),
        f.type || 'application/octet-stream',
        f.name || 'attachment'
      );
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      urls.push(file.getUrl());
    } catch (err) {
      Logger.log('File save error: ' + err.message);
    }
  });

  return urls;
}

// ─────────────────────────────────────────────────────────────
//  Email: confirmation to submitter
// ─────────────────────────────────────────────────────────────

function sendConfirmation(data, fileUrls, territory) {
  if (!data.email) return;

  var school    = data.school || data.district || '';
  var repLine   = territory.rep
    ? '<p>Your assigned representative is <strong>' + territory.rep + '</strong> ' +
      '(<a href="mailto:' + territory.email + '">' + territory.email + '</a>). ' +
      'They will be in touch shortly.</p>'
    : '';

  var subject = 'Your Soundtrap Legal Request has been received';

  var body =
    '<div style="font-family:Helvetica Neue,Helvetica,Arial,sans-serif;max-width:600px;color:#161616;">' +
    '<div style="background:#161616;padding:24px 32px;border-radius:8px 8px 0 0;border-top:4px solid #6551F2;">' +
    '<p style="color:#FDFDF5;font-size:22px;font-weight:700;margin:0;">Soundtrap for Education</p>' +
    '</div>' +
    '<div style="background:#FDFDF5;padding:28px 32px;border-radius:0 0 8px 8px;">' +
    '<p>Hi ' + escHtml(data.firstName || 'there') + ',</p>' +
    '<p>Thank you — we have received your <strong>' + escHtml(data.requestType || 'legal') + '</strong> request' +
    (school ? ' for <strong>' + escHtml(school) + '</strong>' : '') + '.</p>' +
    repLine +
    '<h3 style="color:#6551F2;margin-top:24px;">Request details</h3>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
    tr('Request type', data.requestType + (data.vpatRequested === 'Yes' ? ' + VPAT' : '')) +
    tr('Institution', [data.school, data.district, data.city, data.state, data.country].filter(Boolean).join(', ')) +
    (data.summary ? tr('Summary', escHtml(data.summary)) : '') +
    (data.vpatRequested === 'Yes' ? tr('VPAT', 'Requested') : '') +
    (data.ndpa    === 'Yes' ? tr('NDPA',      'Requested') : '') +
    (data.exhibitE=== 'Yes' ? tr('Exhibit E', 'Requested') : '') +
    (data.pubAvtal=== 'Yes' ? tr('Pub-Avtal', 'Requested') : '') +
    (data.dpa     === 'Yes' ? tr('DPA',       'Requested') : '') +
    '</table>' +
    (fileUrls.length ? '<p style="margin-top:16px;font-size:13px;color:#555;">' +
      fileUrls.length + ' document(s) uploaded.</p>' : '') +
    '<p style="margin-top:24px;font-size:12px;color:#888;">If you have questions in the meantime, ' +
    'email <a href="mailto:legal@soundtrap.com">legal@soundtrap.com</a>.</p>' +
    '</div></div>';

  MailApp.sendEmail({
    to:       data.email,
    subject:  subject,
    htmlBody: body,
  });
}

// ─────────────────────────────────────────────────────────────
//  Email: notification to sales rep
// ─────────────────────────────────────────────────────────────

function sendRepNotification(data, fileUrls, territory) {
  var toEmail = territory.email || FALLBACK_EMAIL;
  var school  = data.school || data.district || 'Unknown';
  var location = [data.state || data.country].filter(Boolean).join(', ');

  var subject =
    'New Legal Request \u2014 ' + (data.requestType || 'Unknown') +
    ' \u2014 ' + school + (location ? ' (' + location + ')' : '');

  var agreements = [];
  if (data.ndpa     === 'Yes') agreements.push('NDPA');
  if (data.exhibitE === 'Yes') agreements.push('Exhibit E');
  if (data.pubAvtal === 'Yes') agreements.push('Pub-Avtal');
  if (data.dpa      === 'Yes') agreements.push('DPA');

  var fileSection = '';
  if (fileUrls.length) {
    fileSection = '<h3 style="color:#6551F2;">Attached documents</h3><ul>';
    fileUrls.forEach(function(url) {
      fileSection += '<li><a href="' + url + '">' + url + '</a></li>';
    });
    fileSection += '</ul>';
  }

  var body =
    '<div style="font-family:Helvetica Neue,Helvetica,Arial,sans-serif;max-width:680px;color:#161616;">' +
    '<div style="background:#161616;padding:20px 28px;border-top:4px solid #6551F2;border-radius:8px 8px 0 0;">' +
    '<p style="color:#FDFDF5;font-size:18px;font-weight:700;margin:0;">New Legal Request</p>' +
    '</div>' +
    '<div style="background:#FDFDF5;padding:24px 28px;border-radius:0 0 8px 8px;">' +
    '<h3 style="color:#6551F2;margin-top:0;">Request details</h3>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
    tr('Request type',     data.requestType + (data.vpatRequested === 'Yes' ? ' + VPAT' : '')) +
    tr('Country',          data.country) +
    tr('State',            data.state) +
    tr('City',             data.city) +
    tr('District',         data.district) +
    tr('School',           data.school) +
    tr('Manual entry',     data.manualEntry) +
    (data.orderPlaced  ? tr('Order placed',  data.orderPlaced)  : '') +
    (data.seats        ? tr('Seats',         data.seats)        : '') +
    (data.orderMethod  ? tr('Order method',  data.orderMethod)  : '') +
    (data.resellerName ? tr('Reseller',      data.resellerName) : '') +
    (agreements.length ? tr('Agreements',    agreements.join(', ')) : '') +
    (data.summary      ? tr('Summary',       escHtml(data.summary)) : '') +
    '</table>' +

    '<h3 style="color:#6551F2;margin-top:20px;">Contact</h3>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
    tr('Name',         escHtml((data.firstName || '') + ' ' + (data.lastName || ''))) +
    tr('Email',        '<a href="mailto:' + escHtml(data.email || '') + '">' + escHtml(data.email || '') + '</a>') +
    tr('Role',         escHtml(data.role) + (data.roleOther ? ' — ' + escHtml(data.roleOther) : '')) +
    tr('Breach contact', escHtml(data.breachContactName || '') + ' &lt;' + escHtml(data.breachContactEmail || '') + '&gt;') +
    (data.purchaseDate ? tr('Purchase date', data.purchaseDate) : '') +
    '</table>' +

    fileSection +

    '<p style="margin-top:20px;font-size:12px;color:#888;">Submitted: ' + new Date().toUTCString() + '</p>' +
    '</div></div>';

  MailApp.sendEmail({
    to:       toEmail,
    subject:  subject,
    htmlBody: body,
  });
}

// ─────────────────────────────────────────────────────────────
//  Utilities
// ─────────────────────────────────────────────────────────────

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Build a two-column table row for email HTML. */
function tr(label, value) {
  if (!value && value !== 0) return '';
  return '<tr>' +
    '<td style="padding:5px 8px;border:1px solid #E8E5F5;font-weight:600;white-space:nowrap;background:#F4F4F5;">' + label + '</td>' +
    '<td style="padding:5px 8px;border:1px solid #E8E5F5;">' + value + '</td>' +
    '</tr>';
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

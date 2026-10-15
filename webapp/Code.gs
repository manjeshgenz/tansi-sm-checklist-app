/**
 * TANSI HONDA – SALES MANAGER DAILY CHECKLIST – Google Apps Script backend (v2)
 * Festival Sales & Operational Control Plan (Oct–Nov 2026)
 *
 * Backend  : Google Sheet bound to this script (every record lives here)
 * Proofs   : Google Drive folder "Branch Audit Proofs/<date>/<branch>/"
 * Frontend : Index.html (mobile-first, Android Material style)
 *
 * RULES ENFORCED ON THE SERVER
 *  - Login with email ID + password.
 *  - A manager can fill / edit ONLY today's checklist (IST). Past and future dates are blocked.
 *  - Editing after submitting is allowed the same day; the checklist goes back to DRAFT and must be re-submitted.
 *  - A manager can view only his own checklists. Admin can view everything but does not fill checklists.
 *  - Admin manages users (add / edit / delete / reset password / activate).
 *  - GM / Viewer role: sees every branch read-only, no user management.
 *  - Daily cut-off time (Config SUBMIT_CUTOFF). After it, today's checklist locks.
 *  - Camera-only proof for items marked CAMERA in Checklist_Master ("Proof Source").
 *  - The same photo can never be uploaded twice (SHA-256 of the original file).
 *
 * FIRST TIME / AFTER EVERY CODE UPDATE: run setup() once (safe – never deletes data).
 * Deploy: Deploy > Manage deployments > Edit > Version: New version (keeps the same URL).
 */

const APP = {
  NAME: 'Tansi Honda – Sales Manager Checklist',
  TZ: 'Asia/Kolkata',
  SESSION_SECONDS: 21600,          // 6 hours (CacheService maximum)
  ROOT_FOLDER: 'Branch Audit Proofs',
  DEFAULT_PW: 'Change@123',        // used when a user's Password Hash cell is blank
  MAX_IMAGE_BYTES: 4 * 1024 * 1024,
  MAX_PHOTO_AGE_MIN: 15,           // camera photos must be taken within the last 15 minutes
  ADMIN_SEED_EMAIL: 'genzaimanjesh@gmail.com'
};

const SH = {
  USERS: 'Users', MASTER: 'Checklist_Master', SUB: 'Submissions', LINES: 'Submission_Items',
  PROOFS: 'Proofs', LOG: 'Audit_Log', CONFIG: 'Config'
};

const HEADERS = {
  Users: ['Email', 'Full Name', 'Branch', 'Role', 'Password Hash', 'Active', 'Must Change Password', 'Phone', 'Created At', 'Last Login'],
  Checklist_Master: ['Item No', 'Pillar', 'Audit Action', 'Metric Fields', 'Proof Required', 'Min Photos', 'Proof Hint', 'Active', 'Proof Source'],
  Submissions: ['Submission ID', 'Date', 'Branch', 'Manager Email', 'Manager Name', 'Status', 'Done', 'Missed', 'N/A', 'Pending', 'Score %',
    'Started At', 'Last Saved At', 'Submitted At', 'Sign-off Name', 'Sign-off Declaration', 'Edits After Submit'],
  Submission_Items: ['Row Key', 'Submission ID', 'Date', 'Branch', 'Manager', 'Item No', 'Pillar', 'Status', 'Metrics (JSON)',
    'Metric 1', 'Metric 2', 'Metric 3', 'Remarks', 'Proof Count', 'Proof Links', 'Updated At'],
  Proofs: ['Proof ID', 'Submission ID', 'Date', 'Branch', 'Item No', 'File ID', 'File URL', 'Latitude', 'Longitude', 'Uploaded By', 'Uploaded At', 'Deleted', 'Photo Hash', 'Source'],
  Audit_Log: ['Timestamp', 'User', 'Action', 'Details'],
  Config: ['Key', 'Value', 'Notes']
};

const DECLARATION = 'I verify that all operational checkpoints above have been personally audited today.';

/* Metric Fields format:  key:Label:type | key:Label:type
   type = number | text | time | select(Option A/Option B)                     */
const SEED_MASTER = [
  [1, 'Morning Alignment Huddle (10 Mins)', 'Reviewed yesterday’s lost sales reasons & set strict daily negotiation rules with team.',
    'gap:Key gap addressed:text', 'Y', 1, 'Photo of the team huddle', 'Y', 'CAMERA'],

  [2, 'Showroom Floor & Walk-In Management', 'Verified all walk-ins were greeted/assigned; sales execs made direct follow-ups or offered "Honda from Home".',
    'walkins:Walk-ins:number|followups:Follow-ups done:number', 'Y', 1, 'Photo of walk-in register / CRM screen', 'Y', 'CAMERA'],

  [3, 'Mandatory Manager Walk-In Rescue', 'Personally intervened and engaged with customers about to leave without buying to close the deal.',
    'rescued:Customers rescued / closed:number', 'Y', 1, 'Booking form or photo with customer', 'Y', 'CAMERA'],

  [4, 'CRE Team & Inquiry Follow-Up Review', 'Reviewed previous day CRE follow-up sheet & spoke directly with CREs on dropped inquiries & voice of customer.',
    'dropped:Dropped inquiries reviewed:number', 'Y', 1, 'Photo of CRE follow-up sheet', 'Y', 'CAMERA'],

  [5, 'Inbound Phone Call Auditing & Refinement', 'Listened to ≥5 previous day call recordings; checked if senior sales person/manager answered using training script.',
    'audited:Calls audited:number|score:Script score:select(Good/Poor)', 'Y', 1, 'Screenshot of call log / recordings list', 'Y', 'ANY'],

  [6, 'In-House Service Center Engagement', 'Sales team visited service bay to target old/high-driven vehicles, pitch upgrade/exchange offers & test drives.',
    'leads:Service upgrade leads generated:number', 'Y', 1, 'Photo of sales exec in service bay', 'Y', 'CAMERA'],

  [7, 'Outdoor Campaigns (Drop-Zones)', 'Executed canopy, umbrella, leaflet & exchange mela activities in historical low-sales drop-zones.',
    'location:Location:text|inquiries:Inquiries:number', 'Y', 2, 'Activity photos – canopy, crowd, leaflets', 'Y', 'CAMERA'],

  [8, 'Delivery Chain Routine & Referrals', 'Conducted scheduled weekly delivery hub visit; promoted vehicle offers & reinforced referral schemes.',
    'hub:Hub visited:text|referrals:Referrals:number', 'Y', 1, 'Photo at the delivery hub (mark N/A on non-visit days)', 'Y', 'CAMERA'],

  [9, 'Institutional, Bank & Office Visits', 'Visited local banks, BESCOM/KEB offices & government bodies to pitch festive offers & exchange schemes.',
    'institutions:Institutions visited:text', 'Y', 1, 'Photo at bank / office visit', 'Y', 'CAMERA'],

  [10, 'Corporate & Residential Community Leads', 'Reached out to corporate HRs via buyers & large residential association heads for society display/camps.',
    'leads:HR / Association leads:text', 'Y', 1, 'Screenshot of message or meeting photo', 'Y', 'ANY'],

  [11, 'Festival Urgency & Fast Exchange Valuations', 'Pushed team to remind customers of limited festival stock/delivery slots, and gave old vehicle price quotes within 10 minutes.',
    'valuations:Exchange spot-valuations done:number', 'Y', 1, 'Photo of valuation sheet', 'Y', 'CAMERA'],

  [12, 'Surprise & Delight Deliveries', 'Captured high-quality photos/videos of vehicle deliveries under festive backdrop; drove social media tags.',
    'deliveries:Festive deliveries completed:number', 'Y', 1, 'Festive delivery photo', 'Y', 'CAMERA'],

  [13, 'Daily Evening Report Submission', 'Compiled walk-in numbers, closure reasons, call audit results & outreach metrics for evening WhatsApp/email report.',
    'time:Report submitted at:time', 'N', 0, 'Tap “WhatsApp report” – the time fills automatically', 'Y', 'ANY']
];

const SEED_CONFIG = [
  ['APP_NAME', 'Sales Manager Checklist', 'App title shown on every screen'],
  ['COMPANY_NAME', 'Tansi Honda', 'Dealership name (login screen, reports)'],
  ['LOGO_FILE_ID', '', 'Optional: Google Drive file ID of the Tansi Honda logo (PNG/JPG, under 80 KB)'],
  ['CAMPAIGN_NAME', 'Festive Sales Campaign 2026', 'Shown in the app & WhatsApp report'],
  ['SUBMIT_CUTOFF', '21:30', 'Today’s checklist locks after this time (24h HH:mm). Blank = midnight'],
  ['DIGEST_HOUR', '20', 'Hour (0-23) for the daily pending-branches email'],
  ['CAMPAIGN_START', '', 'Dashboard counts days from here (yyyy-mm-dd). setup() fills today’s date'],
  ['ADMIN_WHATSAPP', '', 'Admin mobile (10 digits). Evening report opens WhatsApp to this number'],
  ['ADMIN_EMAIL', '', 'Gets the daily pending-branches email. Comma-separate for more people']
];

/* ===================== WEB APP ===================== */

function doGet() {
  let title = APP.NAME;
  try { const c = config_(); title = [c.COMPANY_NAME, c.APP_NAME].filter(String).join(' – ') || title; } catch (e) { }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)   // allows Google Sites embed
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover')
    .addMetaTag('mobile-web-app-capable', 'yes');
}

/** Single entry point used by the frontend. */
function api(action, token, payload) {
  try {
    payload = payload || {};
    if (action === 'login') return ok_(login_(payload));
    if (action === 'publicInfo') return ok_(publicInfo_());
    if (action === 'logout') { if (token) CacheService.getScriptCache().remove('S_' + token); return ok_(true); }
    const user = auth_(token);
    const route = ROUTES[action];
    if (!route) throw new Error('Unknown action: ' + action);
    if (route.admin && user.role !== 'ADMIN') throw new Error('Admin access only');
    if (route.view && !canViewAll_(user)) throw new Error('Not allowed');
    return ok_(route.f(user, payload));
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

const ROUTES = {
  bootstrap: { f: bootstrap_ },
  changePassword: { f: changePassword_ },
  getChecklist: { f: getChecklist_ },
  saveItem: { f: saveItem_ },
  uploadProof: { f: uploadProof_ },
  deleteProof: { f: deleteProof_ },
  getProofImage: { f: getProofImage_ },
  submit: { f: submit_ },
  history: { f: history_ },
  myDashboard: { f: myDashboard_ },
  dashboard: { f: dashboard_, view: true },
  users: { f: listUsers_, admin: true },
  saveUser: { f: saveUser_, admin: true },
  deleteUser: { f: deleteUser_, admin: true },
  resetPassword: { f: resetPassword_, admin: true }
};

/* ===================== SETUP ===================== */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open this script from the Google Sheet (Extensions > Apps Script) and run setup() again.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());
  if (!props.getProperty('SALT')) props.setProperty('SALT', Utilities.getUuid());
  ss.setSpreadsheetTimeZone(APP.TZ);

  const added = {};
  Object.keys(HEADERS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const h = HEADERS[name];
    if (sh.getLastRow() === 0 || String(sh.getRange(1, 1).getValue()) !== h[0]) {
      sh.getRange(1, 1, 1, h.length).setValues([h]);
    } else {
      // upgrade: append any new column that an older version did not have (existing data untouched)
      const have = headers_(sh);
      h.forEach(function (k) {
        if (have.indexOf(k) < 0) {
          sh.getRange(1, have.length + 1).setValue(k); have.push(k);
          (added[name] = added[name] || []).push(k);
        }
      });
    }
    const width = Math.max(h.length, headers_(sh).length);
    sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#CC0000').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  });

  // IDs, dates, emails, phones stay plain text (no auto-date / number mangling)
  [[SH.SUB, ['A:A', 'B:B', 'D:D']], [SH.LINES, ['A:A', 'B:B', 'C:C']], [SH.PROOFS, ['A:A', 'B:B', 'C:C']], [SH.USERS, ['A:A', 'E:E', 'H:H']], [SH.CONFIG, ['B:B']]]
    .forEach(function (x) { const sh = ss.getSheetByName(x[0]); x[1].forEach(function (c) { sh.getRange(c).setNumberFormat('@'); }); });

  const users = ss.getSheetByName(SH.USERS);
  if (users.getLastRow() < 2) {
    const now = new Date();
    const seed = [[APP.ADMIN_SEED_EMAIL, 'Manjesh (Admin)', 'ALL', 'ADMIN', '', 'TRUE', 'TRUE', '', now, '']];
    for (let i = 1; i <= 10; i++) {
      const n = ('0' + i).slice(-2);
      seed.push(['manager' + n + '@fillin.com', 'Manager ' + n + ' – FILL IN', 'Branch ' + n + ' – FILL IN', 'MANAGER', '', 'TRUE', 'TRUE', '', now, '']);
    }
    users.getRange(2, 1, seed.length, seed[0].length).setValues(seed);
  }
  const master = ss.getSheetByName(SH.MASTER);
  if (master.getLastRow() < 2) master.getRange(2, 1, SEED_MASTER.length, SEED_MASTER[0].length).setValues(SEED_MASTER);
  else if ((added[SH.MASTER] || []).indexOf('Proof Source') >= 0) {
    // upgrade: screenshot-type items may use the gallery, everything else is camera-only
    const col = headers_(master).indexOf('Proof Source') + 1;
    const nos = master.getRange(2, 1, master.getLastRow() - 1, 1).getValues();
    master.getRange(2, col, nos.length, 1).setValues(nos.map(function (r) {
      const no = Number(r[0]); return [no === 5 || no === 10 || no === 13 ? 'ANY' : 'CAMERA'];
    }));
  }
  const cfg = ss.getSheetByName(SH.CONFIG);
  const haveKeys = cfg.getLastRow() > 1 ? cfg.getRange(2, 1, cfg.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); }) : [];
  SEED_CONFIG.forEach(function (r) {
    if (haveKeys.indexOf(r[0]) >= 0) return;
    let v = r[1];
    if (r[0] === 'CAMPAIGN_START') v = today_();
    if (r[0] === 'ADMIN_EMAIL') v = APP.ADMIN_SEED_EMAIL;
    cfg.appendRow([r[0], v, r[2]]);
  });
  // old v1 default: switch a blank admin email on, and the generic company/campaign names to Tansi Honda
  cfg.getRange(2, 1, cfg.getLastRow() - 1, 2).getValues().forEach(function (r, i) {
    const k = String(r[0]).trim(), v = String(r[1]).trim();
    if (k === 'ADMIN_EMAIL' && !v) cfg.getRange(i + 2, 2).setValue(APP.ADMIN_SEED_EMAIL);
    if (k === 'COMPANY_NAME' && (!v || v === 'FILL IN')) cfg.getRange(i + 2, 2).setValue('Tansi Honda');
    if (k === 'CAMPAIGN_NAME' && v === 'Honda Festive Sales Campaign 2026') cfg.getRange(i + 2, 2).setValue('Festive Sales Campaign 2026');
  });

  rootFolder_();
  const s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  [SH.MASTER, SH.USERS, SH.CONFIG].forEach(function (n) { ss.getSheetByName(n).autoResizeColumns(1, 4); });
  trimEmptyColumns_(ss);
  installDailyDigest();
  CacheService.getScriptCache().remove('PUBLIC_INFO');

  Logger.log('Setup complete. New columns: ' + JSON.stringify(added) + '. Every new user’s first password: ' + APP.DEFAULT_PW + '.');
  return 'OK';
}

/** Removes unused empty columns on the data tabs (Google counts empty cells towards the 10-million-cell limit). */
function trimEmptyColumns_(ss) {
  Object.keys(HEADERS).forEach(function (name) {
    const sh = ss.getSheetByName(name);
    const used = headers_(sh).length, max = sh.getMaxColumns();
    if (max <= used) return;
    const extra = sh.getRange(1, used + 1, Math.max(1, sh.getLastRow()), max - used).getValues();
    const empty = extra.every(function (r) { return r.every(function (v) { return v === '' || v === null; }); });
    if (empty) sh.deleteColumns(used + 1, max - used);
  });
}

/** Optional: emails ADMIN_EMAIL at ~8 PM with branches that have not submitted. Run once. */
function installDailyDigest() {
  ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'eveningDigest'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  let hour = 20;
  try { const h = parseInt(config_().DIGEST_HOUR, 10); if (h >= 0 && h <= 23) hour = h; } catch (e) { }
  ScriptApp.newTrigger('eveningDigest').timeBased().everyDays(1).atHour(hour).inTimezone(APP.TZ).create();
}

function eveningDigest() {
  const cfg = config_();
  if (!cfg.ADMIN_EMAIL) return;
  const d = dashboard_({ role: 'ADMIN' }, { date: today_() });
  const pending = d.rows.filter(function (r) { return r.status !== 'SUBMITTED'; });
  const lines = pending.map(function (r) {
    return '• ' + r.branch + ' – ' + r.name + ' (' + (r.status === 'DRAFT' ? 'in progress' : 'not started') + ', ' + r.pendingCount + ' items pending'
      + (r.phone ? ', ' + r.phone : '') + ')';
  });
  const cut = cutoff_();
  MailApp.sendEmail(String(cfg.ADMIN_EMAIL), (cfg.COMPANY_NAME || 'Tansi Honda') + ' checklist ' + d.date + ': ' + d.summary.submitted + '/' + d.summary.total + ' submitted',
    (pending.length ? 'Not submitted yet' + (cut ? ' (closes at ' + cut.label + ')' : '') + ':\n' + lines.join('\n') : 'All branches submitted. Well done!')
    + '\n\nAverage score of submitted checklists: ' + d.summary.avgScore + '%');
}

/* ===================== AUTH ===================== */

function login_(p) {
  const em = normEmail_(p.email);
  const pw = String(p.password || '');
  if (!em || !pw) throw new Error('Enter your email ID and password');
  const u = rows_(SH.USERS).find(function (x) { return normEmail_(x['Email']) === em; });
  if (!u || !truthy_(u['Active'])) { log_(em, 'LOGIN_FAIL', 'unknown/inactive'); throw new Error('Invalid email or password'); }
  const stored = String(u['Password Hash'] || '').trim();
  const valid = stored ? stored === hash_(em, pw) : pw === APP.DEFAULT_PW;
  if (!valid) { log_(em, 'LOGIN_FAIL', 'wrong password'); throw new Error('Invalid email or password'); }
  const user = { email: em, name: str_(u['Full Name']), branch: str_(u['Branch']), role: roleOf_(u), phone: str_(u['Phone']) };
  setCell_(SH.USERS, u._row, 'Last Login', new Date());
  log_(em, 'LOGIN', '');
  return { token: newSession_(user), user: user, mustChange: !stored || truthy_(u['Must Change Password']) };
}

/** Shown on the login screen before sign-in: name + logo only. */
function publicInfo_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('PUBLIC_INFO');
  if (hit) return JSON.parse(hit);
  const c = config_();
  const info = { appName: str_(c.APP_NAME || 'Sales Manager Checklist'), company: str_(c.COMPANY_NAME || 'Tansi Honda'), campaign: str_(c.CAMPAIGN_NAME || ''), logo: '' };
  if (c.LOGO_FILE_ID) {
    try {
      const b = DriveApp.getFileById(String(c.LOGO_FILE_ID).trim()).getBlob();
      if (b.getBytes().length < 80000) info.logo = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
    } catch (e) { }
  }
  try { cache.put('PUBLIC_INFO', JSON.stringify(info), 600); } catch (e) { }
  return info;
}

function newSession_(user) {
  const t = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('S_' + t, JSON.stringify(user), APP.SESSION_SECONDS);
  return t;
}

function auth_(token) {
  if (!token) throw new Error('AUTH');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('S_' + token);
  if (!raw) throw new Error('AUTH');
  const s = JSON.parse(raw);
  // re-check the user still exists & is active (admin may have deleted/disabled him)
  const u = rows_(SH.USERS).find(function (x) { return normEmail_(x['Email']) === s.email; });
  if (!u || !truthy_(u['Active'])) { cache.remove('S_' + token); throw new Error('AUTH'); }
  const fresh = { email: s.email, name: str_(u['Full Name']), branch: str_(u['Branch']), role: roleOf_(u), phone: str_(u['Phone']) };
  cache.put('S_' + token, JSON.stringify(fresh), APP.SESSION_SECONDS); // sliding expiry
  return fresh;
}

function changePassword_(user, p) {
  const oldPw = String(p.oldPassword || ''), newPw = String(p.newPassword || '');
  if (newPw.length < 6) throw new Error('New password must be at least 6 characters');
  if (newPw === APP.DEFAULT_PW) throw new Error('Choose a password different from the default');
  const u = findUser_(user.email);
  const stored = String(u['Password Hash'] || '').trim();
  const valid = stored ? stored === hash_(user.email, oldPw) : oldPw === APP.DEFAULT_PW;
  if (!valid) throw new Error('Current password is wrong');
  setCell_(SH.USERS, u._row, 'Password Hash', hash_(user.email, newPw));
  setCell_(SH.USERS, u._row, 'Must Change Password', 'FALSE');
  log_(user.email, 'PASSWORD_CHANGED', '');
  return true;
}

function hash_(email, pw) {
  const salt = PropertiesService.getScriptProperties().getProperty('SALT') || '';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + normEmail_(email) + '|' + pw, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/* ===================== CHECKLIST ===================== */

function bootstrap_(user) {
  const c = cutoff_();
  return { user: user, today: today_(), master: master_(), config: config_(), info: publicInfo_(), cutoff: c ? c.label : '' };
}

function getChecklist_(user, p) {
  const t = target_(user, p);
  const sub = subObj_(t.subId);
  const lines = {}, proofs = {};
  rows_(SH.LINES).forEach(function (r) {
    if (r['Submission ID'] !== t.subId) return;
    let m = {};
    try { m = JSON.parse(r['Metrics (JSON)'] || '{}'); } catch (e) { }
    lines[Number(r['Item No'])] = { status: str_(r['Status']), metrics: m, remarks: str_(r['Remarks']), updatedAt: str_(r['Updated At']) };
  });
  rows_(SH.PROOFS).forEach(function (r) {
    if (r['Submission ID'] !== t.subId || truthy_(r['Deleted'])) return;
    const n = Number(r['Item No']);
    (proofs[n] = proofs[n] || []).push({ id: str_(r['Proof ID']), uploadedAt: str_(r['Uploaded At']) });
  });
  let editable = true, lockReason = '';
  try { assertEditable_(user, t); } catch (e) { editable = false; lockReason = e.message; }
  const c = cutoff_();
  return { date: t.date, today: today_(), subId: t.subId, owner: t.owner, sub: sub ? subSummary_(sub) : null, lines: lines, proofs: proofs, editable: editable, lockReason: lockReason, cutoff: c ? c.label : '' };
}

function saveItem_(user, p) {
  const t = target_(user, p);
  assertEditable_(user, t);
  return withLock_(function () {
    const item = itemOf_(p.itemNo);
    const status = String(p.status || '').toUpperCase();
    if (['DONE', 'MISSED', 'NA', ''].indexOf(status) < 0) throw new Error('Invalid status');
    const metrics = {};
    item.metrics.forEach(function (m) { metrics[m.key] = String((p.metrics || {})[m.key] == null ? '' : p.metrics[m.key]).trim().slice(0, 200); });
    ensureSub_(t);
    const readable = item.metrics.map(function (m) { return metrics[m.key] !== '' ? m.label + ': ' + metrics[m.key] : ''; });
    upsert_(SH.LINES, t.subId + '_' + item.no, Object.assign(lineBase_(t, item), {
      'Status': status, 'Metrics (JSON)': JSON.stringify(metrics),
      'Metric 1': safe_(readable[0] || ''), 'Metric 2': safe_(readable[1] || ''), 'Metric 3': safe_(readable[2] || ''),
      'Remarks': safe_(String(p.remarks || '').trim().slice(0, 600)), 'Updated At': new Date()
    }));
    const reopened = markEdited_(t.subId);
    return { summary: recalc_(t.subId), reopened: reopened };
  });
}

function uploadProof_(user, p) {
  const t = target_(user, p);
  assertEditable_(user, t);
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(p.dataUrl || ''));
  if (!m) throw new Error('Invalid image');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > APP.MAX_IMAGE_BYTES) throw new Error('Image too large');
  const item = itemOf_(p.itemNo);
  const source = String(p.source || '').toLowerCase() === 'camera' ? 'camera' : 'gallery';
  if (item.proofSource === 'CAMERA') {
    if (source !== 'camera') throw new Error('Item #' + item.no + ' needs a live camera photo – gallery photos are not allowed');
    const age = (Date.now() - Number(p.capturedAt || 0)) / 60000;
    if (p.capturedAt && age > APP.MAX_PHOTO_AGE_MIN) throw new Error('This photo was taken ' + Math.round(age) + ' minutes ago. Take a fresh photo now.');
  }
  const hash = String(p.hash || '').toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 64);
  if (hash.length < 16) throw new Error('Could not read the photo – please try again');
  const hashKey = 'h' + hash;   // prefix stops Sheets turning the hex into a number
  return withLock_(function () {
    const dup = rows_(SH.PROOFS).find(function (r) { return String(r['Photo Hash']) === hashKey && !truthy_(r['Deleted']); });
    if (dup) {
      const same = String(dup['Submission ID']) === t.subId;
      throw new Error('This photo was already uploaded' + (same ? ' for item #' + dup['Item No'] + ' today' : ' on ' + dateStr_(dup['Date']) + (String(dup['Submission ID']).slice(11) === user.email ? '' : ' by another branch')) + '. Take a new photo.');
    }
    ensureSub_(t);
    const folder = proofFolder_(t.date, t.owner.branch || t.owner.email);
    const name = t.date + '_' + clean_(t.owner.branch) + '_Item' + ('0' + item.no).slice(-2) + '_' + fmt_(new Date(), 'HHmmss') + '.jpg';
    const file = folder.createFile(Utilities.newBlob(bytes, m[1], name));
    file.setDescription(t.owner.name + ' | ' + t.owner.branch + ' | #' + item.no + ' ' + item.pillar);
    const id = 'P' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    appendObj_(SH.PROOFS, {
      'Proof ID': id, 'Submission ID': t.subId, 'Date': t.date, 'Branch': t.owner.branch, 'Item No': item.no,
      'File ID': file.getId(), 'File URL': file.getUrl(), 'Latitude': p.lat || '', 'Longitude': p.lng || '',
      'Uploaded By': user.email, 'Uploaded At': new Date(), 'Deleted': 'FALSE', 'Photo Hash': hashKey, 'Source': source
    });
    log_(user.email, 'PROOF_UPLOADED', t.subId + ' #' + item.no + ' ' + source);
    syncProofs_(t, item);
    const reopened = markEdited_(t.subId);
    return { id: id, uploadedAt: fmt_(new Date(), 'yyyy-MM-dd HH:mm:ss'), reopened: reopened, summary: recalc_(t.subId) };
  });
}

function deleteProof_(user, p) {
  const pr = rows_(SH.PROOFS).find(function (r) { return r['Proof ID'] === String(p.id); });
  if (!pr) throw new Error('Proof not found');
  const subId = String(pr['Submission ID']);
  const t = target_(user, { date: subId.slice(0, 10), email: subId.slice(11) });
  assertEditable_(user, t);
  return withLock_(function () {
    setCell_(SH.PROOFS, pr._row, 'Deleted', 'TRUE');
    try { DriveApp.getFileById(String(pr['File ID'])).setTrashed(true); } catch (e) { }
    syncProofs_(t, itemOf_(pr['Item No']));
    const reopened = markEdited_(subId);
    return { reopened: reopened, summary: recalc_(subId) };
  });
}

function getProofImage_(user, p) {
  const pr = rows_(SH.PROOFS).find(function (r) { return r['Proof ID'] === String(p.id); });
  if (!pr) throw new Error('Proof not found');
  if (!canViewAll_(user) && String(pr['Submission ID']).slice(11) !== user.email) throw new Error('Not allowed');
  const blob = DriveApp.getFileById(String(pr['File ID'])).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

function submit_(user, p) {
  const t = target_(user, p);
  assertEditable_(user, t);
  return withLock_(function () {
    const data = getChecklist_(user, p);
    const errors = validate_(data);
    if (!String(p.signName || '').trim()) errors.push({ no: 0, msg: 'Type your name to sign off' });
    if (!p.declare) errors.push({ no: 0, msg: 'Tick the declaration' });
    if (errors.length) return { submitted: false, errors: errors };
    ensureSub_(t);
    recalc_(t.subId);
    upsert_(SH.SUB, t.subId, {
      'Status': 'SUBMITTED', 'Submitted At': new Date(),
      'Sign-off Name': safe_(String(p.signName).trim().slice(0, 80)), 'Sign-off Declaration': DECLARATION
    });
    log_(user.email, 'SUBMITTED', t.subId);
    return { submitted: true, summary: subSummary_(subObj_(t.subId)) };
  });
}

function validate_(data) {
  const errors = [];
  master_().forEach(function (i) {
    const l = data.lines[i.no];
    if (!l || !l.status) { errors.push({ no: i.no, msg: 'Mark Done / Missed / N/A' }); return; }
    if (l.status === 'DONE') {
      i.metrics.forEach(function (m) { if (!String((l.metrics || {})[m.key] || '').trim()) errors.push({ no: i.no, msg: 'Fill “' + m.label + '”' }); });
      if (i.proofRequired && (data.proofs[i.no] || []).length < i.minPhotos) errors.push({ no: i.no, msg: 'Add ' + i.minPhotos + ' proof photo' + (i.minPhotos > 1 ? 's' : '') });
    } else if (!String(l.remarks || '').trim()) {
      errors.push({ no: i.no, msg: 'Give the reason for ' + (l.status === 'NA' ? 'N/A' : 'Missed') });
    }
  });
  return errors;
}

function history_(user, p) {
  const em = (canViewAll_(user) && p.email) ? normEmail_(p.email) : user.email;
  return rows_(SH.SUB).filter(function (r) { return normEmail_(r['Manager Email']) === em; })
    .map(subSummary_).sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 90);
}

/* ===================== DASHBOARDS ===================== */

/** Manager's own dashboard: today's pending items + campaign counts. */
function myDashboard_(user) {
  if (canViewAll_(user)) throw new Error('Use the dashboard');
  const today = today_();
  const cl = getChecklist_(user, { date: today });
  const master = master_();
  const pendingItems = master.filter(function (i) { const l = cl.lines[i.no]; return !l || !l.status; })
    .map(function (i) { return { no: i.no, pillar: i.pillar }; });
  const issues = validate_(cl).filter(function (e) { return cl.lines[e.no] && cl.lines[e.no].status; });
  const subs = rows_(SH.SUB).filter(function (r) { return normEmail_(r['Manager Email']) === user.email; });
  const stats = statsFor_(subs, campaignStart_(), today);
  const last7 = [];
  for (let k = 6; k >= 0; k--) {
    const d = shiftDate_(today, -k);
    const s = subs.find(function (x) { return dateStr_(x['Date']) === d; });
    last7.push({ date: d, status: s ? str_(s['Status']) : 'NOT STARTED', score: s ? Number(s['Score %']) || 0 : 0 });
  }
  return {
    today: today, status: cl.sub ? cl.sub.status : 'NOT STARTED', summary: cl.sub,
    total: master.length, pendingItems: pendingItems, issues: issues, stats: stats, last7: last7
  };
}

/** Admin dashboard: every branch for a date + per-user counts for the campaign. */
function dashboard_(user, p) {
  const date = validDate_(p.date || today_());
  const from = validDate_(p.from || campaignStart_());
  const to = validDate_(p.to || today_());
  const managers = rows_(SH.USERS).filter(function (u) { return truthy_(u['Active']) && roleOf_(u) === 'MANAGER'; });
  const subs = rows_(SH.SUB);
  const lines = rows_(SH.LINES).filter(function (l) { return dateStr_(l['Date']) === date; });
  const master = master_();
  const byId = {};
  subs.forEach(function (s) { byId[s['Submission ID']] = s; });

  const rows = managers.map(function (m) {
    const em = normEmail_(m['Email']);
    const s = byId[date + '_' + em];
    const sum = s ? subSummary_(s) : null;
    const answered = {};
    lines.forEach(function (l) { if (l['Submission ID'] === date + '_' + em && l['Status']) answered[Number(l['Item No'])] = 1; });
    const pendingList = master.filter(function (i) { return !answered[i.no]; }).map(function (i) { return i.no; });
    const mine = subs.filter(function (x) { return normEmail_(x['Manager Email']) === em; });
    return {
      email: em, name: str_(m['Full Name']), branch: str_(m['Branch']), phone: str_(m['Phone']),
      status: sum ? sum.status : 'NOT STARTED', done: sum ? sum.done : 0, missed: sum ? sum.missed : 0, na: sum ? sum.na : 0,
      score: sum ? sum.score : 0, submittedAt: sum && sum.submittedAt ? sum.submittedAt.slice(11, 16) : '',
      pendingCount: pendingList.length, pendingList: pendingList, stats: statsFor_(mine, from, to)
    };
  }).sort(function (a, b) { return a.branch.localeCompare(b.branch); });

  const itemStats = master.map(function (i) { return { no: i.no, pillar: i.pillar, done: 0, missed: 0, na: 0, pending: 0 }; });
  const metricTotals = {};
  lines.forEach(function (l) {
    const st = itemStats.find(function (x) { return x.no === Number(l['Item No']); });
    if (!st) return;
    if (l['Status'] === 'DONE') st.done++; else if (l['Status'] === 'MISSED') st.missed++; else if (l['Status'] === 'NA') st.na++;
    if (l['Status'] !== 'DONE') return;
    const item = master.find(function (i) { return i.no === st.no; });
    let mv = {};
    try { mv = JSON.parse(l['Metrics (JSON)'] || '{}'); } catch (e) { }
    item.metrics.forEach(function (f) {
      if (f.type !== 'number') return;
      const k = item.no + '.' + f.key;
      metricTotals[k] = metricTotals[k] || { label: f.label, no: item.no, total: 0 };
      metricTotals[k].total += Number(mv[f.key]) || 0;
    });
  });
  itemStats.forEach(function (s) { s.pending = Math.max(0, rows.length - s.done - s.missed - s.na); });

  const submitted = rows.filter(function (r) { return r.status === 'SUBMITTED'; });
  const trend = [];
  for (let k = 6; k >= 0; k--) {
    const d = shiftDate_(date, -k);
    const ss = subs.filter(function (s) { return dateStr_(s['Date']) === d && s['Status'] === 'SUBMITTED'; });
    trend.push({ date: d, submitted: ss.length, avgScore: ss.length ? Math.round(ss.reduce(function (a, s) { return a + (Number(s['Score %']) || 0); }, 0) / ss.length) : 0 });
  }
  return {
    date: date, from: from, to: to, today: today_(), rows: rows,
    summary: {
      total: rows.length, submitted: submitted.length,
      draft: rows.filter(function (r) { return r.status === 'DRAFT'; }).length,
      notStarted: rows.filter(function (r) { return r.status === 'NOT STARTED'; }).length,
      avgScore: submitted.length ? Math.round(submitted.reduce(function (a, r) { return a + r.score; }, 0) / submitted.length) : 0
    },
    itemStats: itemStats,
    metricTotals: Object.keys(metricTotals).map(function (k) { return metricTotals[k]; }),
    trend: trend
  };
}

/** Counts for a list of submission rows between two dates (inclusive). */
function statsFor_(subs, from, to) {
  if (from > to) from = to;
  const days = daysBetween_(from, to) + 1;
  const inRange = subs.filter(function (s) { const d = dateStr_(s['Date']); return d >= from && d <= to; });
  const submitted = inRange.filter(function (s) { return s['Status'] === 'SUBMITTED'; });
  const today = today_();
  // today is not "missed" yet if the day is still running
  const closedDays = days - (to >= today && from <= today ? 1 : 0);
  const submittedClosed = submitted.filter(function (s) { return dateStr_(s['Date']) !== today; }).length;
  return {
    days: days, submitted: submitted.length,
    notSubmitted: Math.max(0, closedDays - submittedClosed),
    avgScore: submitted.length ? Math.round(submitted.reduce(function (a, s) { return a + (Number(s['Score %']) || 0); }, 0) / submitted.length) : 0,
    completion: closedDays > 0 ? Math.round(submittedClosed * 100 / closedDays) : (submitted.length ? 100 : 0)
  };
}

/* ===================== USER MANAGEMENT (ADMIN) ===================== */

function listUsers_() {
  return rows_(SH.USERS).filter(function (u) { return u['Email'] !== ''; }).map(function (u) {
    return {
      email: normEmail_(u['Email']), name: str_(u['Full Name']), branch: str_(u['Branch']), role: roleOf_(u),
      active: truthy_(u['Active']), phone: str_(u['Phone']), lastLogin: str_(u['Last Login']),
      mustChange: !String(u['Password Hash'] || '').trim() || truthy_(u['Must Change Password'])
    };
  }).sort(function (a, b) { return (a.role === b.role ? 0 : a.role === 'ADMIN' ? -1 : 1) || a.branch.localeCompare(b.branch); });
}

/** Add (no originalEmail) or edit (originalEmail given) a user. */
function saveUser_(admin, p) {
  const email = normEmail_(p.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email ID');
  const name = String(p.name || '').trim(), branch = String(p.branch || '').trim();
  const role = normRole_(p.role);
  if (!name) throw new Error('Enter the full name');
  if (role === 'MANAGER' && !branch) throw new Error('Enter the branch');
  const phone = String(p.phone || '').replace(/\D/g, '').slice(-12);
  const pw = String(p.password || '');
  if (pw && pw.length < 6) throw new Error('Password must be at least 6 characters');
  return withLock_(function () {
    const all = rows_(SH.USERS);
    const orig = p.originalEmail ? normEmail_(p.originalEmail) : '';
    const clash = all.find(function (u) { return normEmail_(u['Email']) === email; });
    if (!orig) {
      if (clash) throw new Error('This email ID already exists');
      appendObj_(SH.USERS, {
        'Email': email, 'Full Name': safe_(name), 'Branch': safe_(branch || 'ALL'), 'Role': role,
        'Password Hash': pw ? hash_(email, pw) : '', 'Active': p.active === false ? 'FALSE' : 'TRUE',
        'Must Change Password': 'TRUE', 'Phone': phone, 'Created At': new Date()
      });
      log_(admin.email, 'USER_ADDED', email + ' (' + role + ')');
      return { created: true, password: pw || APP.DEFAULT_PW };
    }
    const u = all.find(function (x) { return normEmail_(x['Email']) === orig; });
    if (!u) throw new Error('User not found');
    if (email !== orig) {
      if (clash) throw new Error('This email ID already exists');
      const hasData = rows_(SH.SUB).some(function (s) { return normEmail_(s['Manager Email']) === orig; });
      if (hasData) throw new Error('This user already has checklists – the email ID cannot be changed. Add a new user instead.');
    }
    if (orig === admin.email && (role !== 'ADMIN' || p.active === false)) throw new Error('You cannot remove your own admin access');
    const upd = { 'Email': email, 'Full Name': safe_(name), 'Branch': safe_(branch || 'ALL'), 'Role': role, 'Phone': phone, 'Active': p.active === false ? 'FALSE' : 'TRUE' };
    if (pw) { upd['Password Hash'] = hash_(email, pw); upd['Must Change Password'] = 'TRUE'; }
    else if (email !== orig) { upd['Password Hash'] = ''; upd['Must Change Password'] = 'TRUE'; }   // hash is tied to the email
    const sh = sheet_(SH.USERS), h = headers_(sh);
    const row = sh.getRange(u._row, 1, 1, h.length).getValues()[0];
    h.forEach(function (k, i) { if (Object.prototype.hasOwnProperty.call(upd, k)) row[i] = upd[k]; });
    sh.getRange(u._row, 1, 1, h.length).setValues([row]);
    log_(admin.email, 'USER_EDITED', orig + (email !== orig ? ' -> ' + email : ''));
    return { created: false };
  });
}

function deleteUser_(admin, p) {
  const em = normEmail_(p.email);
  if (em === admin.email) throw new Error('You cannot delete yourself');
  return withLock_(function () {
    const u = findUser_(em);
    sheet_(SH.USERS).deleteRow(u._row);
    log_(admin.email, 'USER_DELETED', em + ' (checklist history kept)');
    return true;
  });
}

function resetPassword_(admin, p) {
  const u = findUser_(p.email);
  setCell_(SH.USERS, u._row, 'Password Hash', '');
  setCell_(SH.USERS, u._row, 'Must Change Password', 'TRUE');
  log_(admin.email, 'RESET_PASSWORD', p.email);
  return { defaultPassword: APP.DEFAULT_PW };
}

/* ===================== DOMAIN HELPERS ===================== */

function target_(user, p) {
  const date = validDate_(p.date || today_());
  let em = user.email;
  if (p.email && normEmail_(p.email) !== user.email) {
    if (!canViewAll_(user)) throw new Error('You can view only your own checklists');
    em = normEmail_(p.email);
  }
  let owner = { email: em, name: user.name, branch: user.branch };
  if (em !== user.email) {
    const u = rows_(SH.USERS).find(function (x) { return normEmail_(x['Email']) === em; });
    owner = u ? { email: em, name: str_(u['Full Name']), branch: str_(u['Branch']) } : { email: em, name: em + ' (deleted user)', branch: '' };
  }
  return { date: date, subId: date + '_' + em, owner: owner };
}

/** STRICT: only the owner, only a manager, only today (IST). */
function assertEditable_(user, t) {
  if (user.role !== 'MANAGER') throw new Error('View only – ' + (user.role === 'VIEWER' ? 'GM view' : 'admins review') + ', managers fill checklists');
  if (t.owner.email !== user.email) throw new Error('You can edit only your own checklist');
  const today = today_();
  if (t.date < today) throw new Error('Past checklists are locked. You can fill only today’s checklist.');
  if (t.date > today) throw new Error('Future checklists cannot be filled. You can fill only today’s checklist.');
  const c = cutoff_();
  if (c && fmt_(new Date(), 'HH:mm') >= c.hhmm) throw new Error('Today’s checklist closed at ' + c.label + '. Ask your admin if you need help.');
}

/** If today's checklist was already submitted, an edit moves it back to DRAFT (must re-submit). */
function markEdited_(subId) {
  const s = subObj_(subId);
  if (!s || s['Status'] !== 'SUBMITTED') return false;
  upsert_(SH.SUB, subId, { 'Status': 'DRAFT', 'Edits After Submit': (Number(s['Edits After Submit']) || 0) + 1 });
  log_(String(s['Manager Email']), 'EDIT_AFTER_SUBMIT', subId);
  return true;
}

function ensureSub_(t) {
  if (findRow_(sheet_(SH.SUB), t.subId)) return;
  appendObj_(SH.SUB, {
    'Submission ID': t.subId, 'Date': t.date, 'Branch': t.owner.branch, 'Manager Email': t.owner.email,
    'Manager Name': t.owner.name, 'Status': 'DRAFT', 'Done': 0, 'Missed': 0, 'N/A': 0,
    'Pending': master_().length, 'Score %': 0, 'Started At': new Date(), 'Last Saved At': new Date(), 'Edits After Submit': 0
  });
}

function recalc_(subId) {
  const total = master_().length;
  let done = 0, missed = 0, na = 0;
  rows_(SH.LINES).forEach(function (l) {
    if (l['Submission ID'] !== subId) return;
    if (l['Status'] === 'DONE') done++; else if (l['Status'] === 'MISSED') missed++; else if (l['Status'] === 'NA') na++;
  });
  const pending = Math.max(0, total - done - missed - na);
  const score = (done + missed) ? Math.round(done * 100 / (done + missed)) : 0;
  upsert_(SH.SUB, subId, { 'Done': done, 'Missed': missed, 'N/A': na, 'Pending': pending, 'Score %': score, 'Last Saved At': new Date() });
  const s = subObj_(subId);
  return { done: done, missed: missed, na: na, pending: pending, score: score, status: s ? str_(s['Status']) : 'DRAFT' };
}

function syncProofs_(t, item) {
  const list = rows_(SH.PROOFS).filter(function (r) { return r['Submission ID'] === t.subId && Number(r['Item No']) === item.no && !truthy_(r['Deleted']); });
  upsert_(SH.LINES, t.subId + '_' + item.no, Object.assign(lineBase_(t, item), {
    'Proof Count': list.length, 'Proof Links': list.map(function (r) { return r['File URL']; }).join('\n'), 'Updated At': new Date()
  }));
}

function lineBase_(t, item) {
  return { 'Submission ID': t.subId, 'Date': t.date, 'Branch': t.owner.branch, 'Manager': t.owner.name, 'Item No': item.no, 'Pillar': item.pillar };
}

function itemOf_(no) {
  const item = master_().find(function (i) { return i.no === Number(no); });
  if (!item) throw new Error('Unknown checklist item');
  return item;
}

function subObj_(subId) {
  const sh = sheet_(SH.SUB);
  const r = findRow_(sh, subId);
  return r ? rowObj_(sh, r) : null;
}

function subSummary_(s) {
  return {
    subId: str_(s['Submission ID']), date: dateStr_(s['Date']), branch: str_(s['Branch']), manager: str_(s['Manager Name']),
    status: str_(s['Status']) || 'DRAFT', done: Number(s['Done']) || 0, missed: Number(s['Missed']) || 0, na: Number(s['N/A']) || 0,
    pending: Number(s['Pending']) || 0, score: Number(s['Score %']) || 0, submittedAt: str_(s['Submitted At']),
    signName: str_(s['Sign-off Name']), edits: Number(s['Edits After Submit']) || 0
  };
}

const _masterCache = {};
function master_() {
  if (_masterCache.v) return _masterCache.v;
  return (_masterCache.v = rows_(SH.MASTER).filter(function (r) { return r['Item No'] !== '' && (r['Active'] === '' || truthy_(r['Active'])); })
    .map(function (r) {
      const req = truthy_(r['Proof Required']);
      return {
        no: Number(r['Item No']), pillar: str_(r['Pillar']), action: str_(r['Audit Action']), metrics: parseMetrics_(r['Metric Fields']),
        proofRequired: req, minPhotos: req ? Math.max(1, Number(r['Min Photos']) || 1) : 0, proofHint: str_(r['Proof Hint']),
        proofSource: String(r['Proof Source'] || '').trim().toUpperCase() === 'ANY' ? 'ANY' : 'CAMERA'
      };
    }).sort(function (a, b) { return a.no - b.no; }));
}

function parseMetrics_(s) {
  return String(s || '').split('|').map(function (x) { return x.trim(); }).filter(String).map(function (x) {
    const parts = x.split(':').map(function (y) { return y.trim(); });
    let type = (parts[2] || 'text').toLowerCase(), options = [];
    const m = /^select\((.*)\)$/i.exec(parts[2] || '');
    if (m) { type = 'select'; options = m[1].split('/').map(function (o) { return o.trim(); }); }
    return { key: parts[0], label: parts[1] || parts[0], type: type, options: options };
  });
}

const _cfgCache = {};
function config_() {
  if (_cfgCache.v) return _cfgCache.v;
  const o = (_cfgCache.v = {});
  rows_(SH.CONFIG).forEach(function (r) { if (r['Key']) o[String(r['Key']).trim()] = r['Value'] instanceof Date ? dateStr_(r['Value']) : r['Value']; });
  return o;
}

function campaignStart_() {
  const c = String(config_().CAMPAIGN_START || '').slice(0, 10);
  const t = today_();
  return /^\d{4}-\d{2}-\d{2}$/.test(c) && c <= t ? c : t.slice(0, 8) + '01';
}

function findUser_(em) {
  const u = rows_(SH.USERS).find(function (x) { return normEmail_(x['Email']) === normEmail_(em); });
  if (!u) throw new Error('User not found: ' + em);
  return u;
}

function roleOf_(u) { return normRole_(u['Role']); }
function normRole_(r) { r = String(r || '').trim().toUpperCase(); return r === 'ADMIN' ? 'ADMIN' : (r === 'VIEWER' || r === 'GM') ? 'VIEWER' : 'MANAGER'; }
function canViewAll_(user) { return user.role === 'ADMIN' || user.role === 'VIEWER'; }

/** Config SUBMIT_CUTOFF "21:30" -> { hhmm: '21:30', label: '9:30 PM' } or null. */
function cutoff_() {
  const raw = config_().SUBMIT_CUTOFF;
  let v = raw instanceof Date ? fmt_(raw, 'HH:mm') : String(raw || '').trim();
  const m = /^(\d{1,2})[:.](\d{2})/.exec(v);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  const hhmm = ('0' + h).slice(-2) + ':' + ('0' + mi).slice(-2);
  return { hhmm: hhmm, label: (h % 12 || 12) + ':' + ('0' + mi).slice(-2) + ' ' + (h < 12 ? 'AM' : 'PM') };
}

function rootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ROOT_FOLDER_ID');
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { } }
  const f = DriveApp.createFolder(APP.ROOT_FOLDER);
  props.setProperty('ROOT_FOLDER_ID', f.getId());
  return f;
}

function proofFolder_(date, branch) { return child_(child_(rootFolder_(), date), clean_(branch) || 'Branch'); }
function child_(parent, name) { const it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }

/* ===================== SHEET HELPERS ===================== */

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

const _sheetCache = {};
function sheet_(name) {
  if (_sheetCache[name]) return _sheetCache[name];
  const s = ss_().getSheetByName(name);
  if (!s) throw new Error('Sheet "' + name + '" missing – run setup() once.');
  return (_sheetCache[name] = s);
}

function headers_(sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String); }

function rows_(name) {
  const v = sheet_(name).getDataRange().getValues();
  const h = v.shift().map(String);
  return v.map(function (r, i) { const o = { _row: i + 2 }; h.forEach(function (k, j) { o[k] = r[j]; }); return o; });
}

function rowObj_(sh, r) {
  const h = headers_(sh);
  const v = sh.getRange(r, 1, 1, h.length).getValues()[0];
  const o = { _row: r };
  h.forEach(function (k, j) { o[k] = v[j]; });
  return o;
}

function findRow_(sh, key) {
  if (sh.getLastRow() < 2) return 0;
  const f = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(String(key)).matchEntireCell(true).findNext();
  return f ? f.getRow() : 0;
}

function upsert_(name, key, obj) {
  const sh = sheet_(name), h = headers_(sh);
  let r = findRow_(sh, key), row;
  if (r) row = sh.getRange(r, 1, 1, h.length).getValues()[0];
  else { row = h.map(function () { return ''; }); row[0] = key; r = sh.getLastRow() + 1; }
  h.forEach(function (k, i) { if (Object.prototype.hasOwnProperty.call(obj, k)) row[i] = obj[k]; });
  sh.getRange(r, 1, 1, h.length).setValues([row]);
  return r;
}

function appendObj_(name, obj) {
  const sh = sheet_(name), h = headers_(sh);
  sh.appendRow(h.map(function (k) { return Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : ''; }));
}

function setCell_(name, row, header, value) {
  const sh = sheet_(name), c = headers_(sh).indexOf(header);
  if (c >= 0) sh.getRange(row, c + 1).setValue(value);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('Server busy – please try again');
  try { return fn(); } finally { SpreadsheetApp.flush(); lock.releaseLock(); }
}

function log_(user, action, details) {
  try { sheet_(SH.LOG).appendRow([new Date(), user, action, String(details || '').slice(0, 500)]); } catch (e) { }
}

/* ===================== GENERIC HELPERS ===================== */

function ok_(data) { return { ok: true, data: data }; }
function fmt_(d, p) { return Utilities.formatDate(d, APP.TZ, p); }
function today_() { return fmt_(new Date(), 'yyyy-MM-dd'); }
function str_(v) { return v instanceof Date ? fmt_(v, 'yyyy-MM-dd HH:mm:ss') : (v == null ? '' : String(v)); }
function dateStr_(v) { return v instanceof Date ? fmt_(v, 'yyyy-MM-dd') : String(v || '').slice(0, 10); }
function normEmail_(v) { return String(v || '').trim().toLowerCase(); }
function truthy_(v) { return v === true || /^(true|yes|y|1)$/i.test(String(v).trim()); }
function clean_(s) { return String(s || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 40); }
function safe_(s) { s = String(s); return /^[=+\-@]/.test(s) ? "'" + s : s; }
function validDate_(d) { d = String(d); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Invalid date'); return d; }
function utc_(d) { const p = d.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
function daysBetween_(a, b) { return Math.round((utc_(b) - utc_(a)) / 864e5); }
function shiftDate_(d, n) { return Utilities.formatDate(new Date(utc_(d) + n * 864e5), 'UTC', 'yyyy-MM-dd'); }

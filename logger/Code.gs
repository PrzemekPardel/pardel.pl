/**
 * Contact log for pardel.pl
 *
 * Google Apps Script web app bound to a Google Sheet.
 *   POST  stores one visit (or adds an approximate location to a visit of the same session)
 *   POST  also receives messages from the contact form (sheet 'Contact')
 *   POST  also receives chat lines from the home page (sheet 'Chat')
 *   GET   returns aggregated statistics used by the page; GET ?chat=1 returns the chat
 *
 * Stored columns: timestamp, session, timezone, language, referrer, device, lat, lon, consent, name.
 * The name is optional, chosen by the visitor (max. 30 characters) and shown next to the point.
 * No IP addresses, user agents or persistent identifiers are stored.
 */

var SHEET_NAME = 'contacts';
var HEADER = ['timestamp', 'session', 'timezone', 'language', 'referrer', 'device', 'lat', 'lon', 'consent', 'name'];
var NAME_COL = 10;

var CONTACT_SHEET = 'Contact';
var CONTACT_HEADER = ['timestamp', 'name', 'reply to', 'message', 'language'];
var CONTACT_PER_HOUR = 30;    // upper limit of accepted messages per hour, against floods
var NAME_MAX = 30;

var CHAT_SHEET = 'Chat';
var CHAT_HEADER = ['timestamp', 'session', 'nick', 'text'];
var CHAT_MAX = 300;           // characters per line
var CHAT_LINES = 80;          // lines returned to the page
var CHAT_WINDOW_H = 72;       // only lines from the last 72 hours are returned
var CHAT_RETENTION_DAYS = 30; // chat rows older than this are removed by purgeOldRows()
var CHAT_GAP_MS = 2000;       // minimum time between two lines from one session
var CHAT_PER_10MIN = 30;      // lines per session per 10 minutes
var CHAT_PER_MIN = 60;        // lines per minute for the whole channel
var ONLINE_MS = 45000;        // a session counts as online if it polled within this time
var PUBLIC_POINTS = 1000;     // most recent visits returned to the page
var RETENTION_DAYS = 365;     // rows older than this are removed by purgeOldRows()
var CACHE_SECONDS = 60;

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADER);
    sh.setFrozenRows(1);
  } else if (sh.getRange(1, NAME_COL).getValue() === '') {
    sh.getRange(1, NAME_COL).setValue('name');   // sheets created before the name column existed
  }
  return sh;
}

function contactSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONTACT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CONTACT_SHEET);
    sh.appendRow(CONTACT_HEADER);
    sh.setFrozenRows(1);
    sh.setColumnWidth(4, 520);
    sh.getRange('D:D').setWrap(true);
  }
  return sh;
}

function chatSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CHAT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CHAT_SHEET);
    sh.appendRow(CHAT_HEADER);
    sh.setFrozenRows(1);
    sh.setColumnWidth(4, 520);
  }
  return sh;
}

// Stores one chat line. Lines with links are refused; repeated or too frequent lines are dropped.
function storeChat_(sid, d) {
  var nick = name_(d.nick);
  var line = String(d.text === null || d.text === undefined ? '' : d.text)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_MAX);
  if (!nick || !line) return;
  if (/(https?:|www\.|\b[a-z0-9-]+\.(com|net|org|pl|io|ru|xyz|info|biz|top|link|click)\b)/i.test(line.replace(/\bpardel\.pl\b/gi, ''))) return;
  if (/^[=+\-@]/.test(line)) line = "'" + line;

  var cache = CacheService.getScriptCache();
  var now = Date.now();
  var lastKey = 'cl-' + sid, winKey = 'cw-' + sid + '-' + Math.floor(now / 6e5), minKey = 'cm-' + Math.floor(now / 6e4);
  var prev = cache.getAll([lastKey, winKey, minKey]);
  var last = prev[lastKey] ? JSON.parse(prev[lastKey]) : null;
  if (last && (now - last.t < CHAT_GAP_MS || (last.x === line && now - last.t < 60000))) return;
  if (Number(prev[winKey] || 0) >= CHAT_PER_10MIN) return;
  if (Number(prev[minKey] || 0) >= CHAT_PER_MIN) return;
  cache.put(lastKey, JSON.stringify({ t: now, x: line }), 600);
  cache.put(winKey, String(Number(prev[winKey] || 0) + 1), 660);
  cache.put(minKey, String(Number(prev[minKey] || 0) + 1), 90);

  chatSheet_().appendRow([new Date(now), sid, nick, line]);
  cache.remove('chat');
}

// Recent chat lines and the number of sessions that polled the chat recently.
function chat_(sid) {
  var cache = CacheService.getScriptCache();
  var now = Date.now();

  var pres = {};
  try { pres = JSON.parse(cache.get('pres') || '{}'); } catch (err) { pres = {}; }
  if (sid) pres[sid] = now;
  var online = 0, kept = {};
  Object.keys(pres).forEach(function (k) {
    if (now - pres[k] < ONLINE_MS) { kept[k] = pres[k]; online++; }
  });
  cache.put('pres', JSON.stringify(kept), 300);

  var lines = cache.get('chat');
  if (!lines) {
    var sh = chatSheet_();
    var last = sh.getLastRow();
    var out = [];
    if (last >= 2) {
      var from = Math.max(2, last - 299);
      var rows = sh.getRange(from, 1, last - from + 1, 4).getValues();
      var limit = now - CHAT_WINDOW_H * 36e5;
      rows.forEach(function (r) {
        var ts = new Date(r[0]).getTime();
        if (!isFinite(ts) || ts < limit || !r[2] || !r[3]) return;
        var t = String(r[3]);
        out.push([new Date(ts).toISOString(), String(r[2]), t.charAt(0) === "'" ? t.slice(1) : t]);
      });
    }
    lines = JSON.stringify(out.slice(-CHAT_LINES));
    cache.put('chat', lines, 30);
  }
  return json_('{"online":' + Math.max(1, online) + ',"lines":' + lines + '}');
}

// Multi-line plain text (line breaks kept, other control characters removed).
function message_(value, maxLen) {
  var s = String(value === null || value === undefined ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLen);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function storeMessage_(d) {
  if (d.website) return;                         // hidden field filled in: automated submission
  if (!(Number(d.elapsed) >= 3000)) return;      // sent faster than a person can type
  var name = text_(d.name, 60), reply = text_(d.reply, 100), msg = message_(d.message, 600);
  if (name.length < 2 || reply.length < 5 || msg.length < 10) return;

  var cache = CacheService.getScriptCache();
  var key = 'msg-' + Math.floor(Date.now() / 36e5);
  var count = Number(cache.get(key) || 0);
  if (count >= CONTACT_PER_HOUR) return;
  cache.put(key, String(count + 1), 3700);

  contactSheet_().appendRow([new Date(), name, reply, msg, text_(d.lang, 16)]);
}

// Visitor-chosen label: letters, digits, spaces and . _ - ' only; links are rejected.
function name_(value) {
  var s = String(value === null || value === undefined ? '' : value)
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N} ._'\-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  if (/(https?|www\.|\.(com|net|org|pl|io|ru|xyz)\b)/i.test(s)) return '';
  return s.replace(/^[=+\-@']+/, '');
}

// Row numbers of the most recent rows belonging to the given session strings.
function rowsFor_(sh, sids) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var from = Math.max(2, last - 1999);
  var ids = sh.getRange(from, 2, last - from + 1, 1).getValues();
  var out = [];
  for (var i = 0; i < ids.length; i++) {
    if (sids.indexOf(String(ids[i][0])) !== -1) out.push(from + i);
  }
  return out;
}

// Plain text only; values starting with a formula character are neutralised.
function text_(value, maxLen) {
  var s = String(value === null || value === undefined ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maxLen);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function coord_(value, limit) {
  var x = Number(value);
  if (!isFinite(x) || Math.abs(x) > limit) return '';
  return Math.round(x * 10) / 10;   // about 10 km
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    var raw = (e && e.postData && e.postData.contents) || '{}';
    if (raw.length > 2000) return ok_();
    var d = JSON.parse(raw);
    var sid = text_(d.sid, 40);
    if (!sid) return ok_();
    var sh = sheet_();

    if (d.type === 'locate') {
      if (d.consent !== true) return ok_();
      var lat = coord_(d.lat, 90), lon = coord_(d.lon, 180);
      if (lat === '' || lon === '') return ok_();
      var last = sh.getLastRow();
      var from = Math.max(2, last - 499);
      if (last >= 2) {
        var ids = sh.getRange(from, 2, last - from + 1, 1).getValues();
        for (var i = ids.length - 1; i >= 0; i--) {
          if (ids[i][0] === sid) {
            sh.getRange(from + i, 7, 1, 3).setValues([[lat, lon, 'yes']]);
            invalidate_();
            return ok_();
          }
        }
      }
      return ok_();
    }

    if (d.type === 'chat') {
      storeChat_(sid, d);
      return ok_();
    }

    if (d.type === 'message') {
      storeMessage_(d);
      return ok_();
    }

    if (d.type === 'name') {
      // Sets, changes or removes the name on all visits of this browser (up to 20 sessions).
      var list = (Array.isArray(d.sids) ? d.sids : []).concat([sid])
        .map(function (x) { return text_(x, 40); })
        .filter(function (x) { return x && x.charAt(0) !== "'"; })
        .slice(-21);
      var label = name_(d.name);
      rowsFor_(sh, list).forEach(function (row) {
        sh.getRange(row, NAME_COL).setValue(label);
      });
      invalidate_();
      return ok_();
    }

    if (d.type === 'visit') {
      sh.appendRow([
        new Date(),
        sid,
        text_(d.tz, 64) || 'unknown',
        text_(d.lang, 16),
        text_(d.ref, 100),
        d.device === 'mobile' ? 'mobile' : 'desktop',
        '', '', 'no',
        name_(d.name)
      ]);
      invalidate_();
    }
  } catch (err) {
    // malformed input is ignored
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
  return ok_();
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.chat) {
    var s = text_(p.sid, 40);
    return chat_(s && s.charAt(0) !== "'" ? s : '');
  }
  var cache = CacheService.getScriptCache();
  var hit = cache.get('stats');
  if (hit) return json_(hit);

  var sh = sheet_();
  var last = sh.getLastRow();
  var rows = last >= 2 ? sh.getRange(2, 1, last - 1, HEADER.length).getValues() : [];
  var now = Date.now();
  var d1 = 0, d7 = 0, d28 = 0, d365 = 0, located = 0, named = 0, zones = {}, lastTs = 0;

  rows.forEach(function (r) {
    var ts = new Date(r[0]).getTime();
    if (!isFinite(ts)) return;
    if (now - ts < 864e5) d1++;
    if (now - ts < 7 * 864e5) d7++;
    if (now - ts < 28 * 864e5) d28++;
    if (now - ts < 365 * 864e5) d365++;
    if (r[6] !== '' && r[7] !== '') located++;
    if (r[9] !== '' && r[9] !== undefined) named++;
    var z = String(r[2] || 'unknown');
    zones[z] = (zones[z] || 0) + 1;
    if (ts > lastTs) lastTs = ts;
  });

  var places = Object.keys(zones)
    .map(function (k) { return [k, zones[k]]; })
    .sort(function (a, b) { return b[1] - a[1]; })
    .slice(0, 8);

  // Public coordinates are rounded to whole degrees (about 100 km).
  var points = rows.slice(-PUBLIC_POINTS).map(function (r) {
    var hasGeo = r[6] !== '' && r[7] !== '';
    return [
      new Date(r[0]).toISOString(),
      String(r[2] || ''),
      hasGeo ? Math.round(Number(r[6])) : null,
      hasGeo ? Math.round(Number(r[7])) : null,
      String(r[9] || '')
    ];
  });

  var out = JSON.stringify({
    total: rows.length,
    last24h: d1,
    last7d: d7,
    last28d: d28,
    last365d: d365,
    zones: Object.keys(zones).length,
    located: located,
    named: named,
    last: lastTs ? new Date(lastTs).toISOString() : null,
    places: places,
    points: points
  });
  cache.put('stats', out, CACHE_SECONDS);
  return json_(out);
}

/** Run daily from a time-driven trigger: removes visits and messages older than RETENTION_DAYS
 *  and chat lines older than CHAT_RETENTION_DAYS. */
function purgeOldRows() {
  [[sheet_(), RETENTION_DAYS], [contactSheet_(), RETENTION_DAYS], [chatSheet_(), CHAT_RETENTION_DAYS]].forEach(function (pair) {
    var sh = pair[0];
    var last = sh.getLastRow();
    if (last < 2) return;
    var limit = Date.now() - pair[1] * 864e5;
    var stamps = sh.getRange(2, 1, last - 1, 1).getValues();
    var n = 0;
    while (n < stamps.length && new Date(stamps[n][0]).getTime() < limit) n++;
    if (n > 0) sh.deleteRows(2, n);
  });
  invalidate_();
  CacheService.getScriptCache().remove('chat');
}

function invalidate_() {
  CacheService.getScriptCache().remove('stats');
}

function ok_() {
  return ContentService.createTextOutput('ok');
}

function json_(s) {
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON);
}

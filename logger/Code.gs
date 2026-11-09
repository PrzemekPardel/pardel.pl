/**
 * Contact log for pardel.pl
 *
 * Google Apps Script web app bound to a Google Sheet.
 *   POST  stores one visit (or adds an approximate location to a visit of the same session)
 *   GET   returns aggregated statistics used by the page
 *
 * Stored columns: timestamp, session, timezone, language, referrer, device, lat, lon, consent.
 * No IP addresses, user agents or persistent identifiers are stored.
 */

var SHEET_NAME = 'contacts';
var HEADER = ['timestamp', 'session', 'timezone', 'language', 'referrer', 'device', 'lat', 'lon', 'consent'];
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
  }
  return sh;
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

    if (d.type === 'visit') {
      sh.appendRow([
        new Date(),
        sid,
        text_(d.tz, 64) || 'unknown',
        text_(d.lang, 16),
        text_(d.ref, 100),
        d.device === 'mobile' ? 'mobile' : 'desktop',
        '', '', 'no'
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

function doGet() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('stats');
  if (hit) return json_(hit);

  var sh = sheet_();
  var last = sh.getLastRow();
  var rows = last >= 2 ? sh.getRange(2, 1, last - 1, HEADER.length).getValues() : [];
  var now = Date.now();
  var d1 = 0, d7 = 0, d28 = 0, d365 = 0, located = 0, zones = {}, lastTs = 0;

  rows.forEach(function (r) {
    var ts = new Date(r[0]).getTime();
    if (!isFinite(ts)) return;
    if (now - ts < 864e5) d1++;
    if (now - ts < 7 * 864e5) d7++;
    if (now - ts < 28 * 864e5) d28++;
    if (now - ts < 365 * 864e5) d365++;
    if (r[6] !== '' && r[7] !== '') located++;
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
      hasGeo ? Math.round(Number(r[7])) : null
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
    last: lastTs ? new Date(lastTs).toISOString() : null,
    places: places,
    points: points
  });
  cache.put('stats', out, CACHE_SECONDS);
  return json_(out);
}

/** Run daily from a time-driven trigger: removes rows older than RETENTION_DAYS. */
function purgeOldRows() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return;
  var limit = Date.now() - RETENTION_DAYS * 864e5;
  var stamps = sh.getRange(2, 1, last - 1, 1).getValues();
  var n = 0;
  while (n < stamps.length && new Date(stamps[n][0]).getTime() < limit) n++;
  if (n > 0) sh.deleteRows(2, n);
  invalidate_();
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

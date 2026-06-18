// Web Worker — streams delivery confirmation lines off the main thread.
// Input:  { file: File }
// Output: { type: 'progress', pct } | { type: 'done', entries: Array }
//
// Matches lines like:
//   [Fri May 29 13:35:54 2026] Nablea told you, 'I will deliver the Money (300p) to Digdug as soon as possible!'
//   [Fri May 29 13:35:54 2026] You offered Copper Disc to Digdug.
//   [Fri May 29 13:35:54 2026] You complete the trade with Digdug.
//   [Fri May 29 13:35:54 2026] You have cancelled the trade.
//   [Fri May 29 13:35:54 2026] Digdug has cancelled the trade.

var LINE_RE          = /^\[(\w{3} \w{3} \d{1,2} \d{2}:\d{2}:\d{2} \d{4})\] (.+)$/;
var DELIVERY_RE      = /^(.+?) told you, '(I will deliver the (.+?) to (\S+) as soon as possible!)'/;
var OFFERED_RE       = /^You offered (.+?) to (.+?)\.$/;
var TRADE_COMPLETE_RE= /^You complete the trade with (.+?)\.$/;
var CANCELLED_YOU_RE = /^You have cancelled the trade\.$/;
var CANCELLED_PLR_RE = /^(.+?) has cancelled the trade\.$/;
var MONTHS           = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };

function parseEQDate(raw) {
  var p = raw.split(' ');
  var t = p[3].split(':');
  return new Date(+p[4], MONTHS[p[1]], +p[2], +t[0], +t[1], +t[2]);
}

function parseLine(line, rawEvents) {
  var lineMatch = line.match(LINE_RE);
  if (!lineMatch) return;

  var body = lineMatch[2].trim();
  var m;

  m = body.match(DELIVERY_RE);
  if (m) {
    rawEvents.push({ entryType: 'delivery', deliverer: m[1], rawMessage: m[2],
      item: m[3], recipient: m[4], timestamp: lineMatch[1],
      date: parseEQDate(lineMatch[1]), rawLine: line });
    return;
  }

  m = body.match(OFFERED_RE);
  if (m) {
    rawEvents.push({ entryType: 'offered', item: m[1], recipient: m[2],
      timestamp: lineMatch[1], date: parseEQDate(lineMatch[1]), rawLine: line });
    return;
  }

  m = body.match(TRADE_COMPLETE_RE);
  if (m) {
    rawEvents.push({ entryType: 'trade_complete', item: '', recipient: m[1],
      timestamp: lineMatch[1], date: parseEQDate(lineMatch[1]), rawLine: line });
    return;
  }

  if (CANCELLED_YOU_RE.test(body)) {
    rawEvents.push({ entryType: 'cancelled_self', item: '', recipient: '',
      timestamp: lineMatch[1], date: parseEQDate(lineMatch[1]), rawLine: line });
    return;
  }

  m = body.match(CANCELLED_PLR_RE);
  if (m) {
    rawEvents.push({ entryType: 'cancelled_player', item: '', recipient: m[1],
      timestamp: lineMatch[1], date: parseEQDate(lineMatch[1]), rawLine: line });
  }
}

self.onmessage = async function (e) {
  var file      = e.data.file;
  var fileSize  = file.size;
  var bytesRead = 0;
  var remainder = '';
  var lastPct   = 0;
  var rawEvents = [];

  // ── Pass 1: stream file line-by-line ───────────────────────────────────────
  var reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();

  while (true) {
    var chunk = await reader.read();
    if (chunk.done) break;

    var text = chunk.value;
    bytesRead += (new TextEncoder().encode(text)).length;
    var pct = Math.min(99, Math.round(bytesRead / fileSize * 100));
    if (pct !== lastPct) {
      self.postMessage({ type: 'progress', pct: pct });
      lastPct = pct;
    }

    var combined = remainder + text;
    var lines    = combined.split(/\r?\n/);
    remainder    = lines.pop(); // last element may be an incomplete line

    for (var i = 0; i < lines.length; i++) {
      parseLine(lines[i], rawEvents);
    }
  }

  if (remainder) parseLine(remainder, rawEvents);

  // ── Pass 2: resolve trade windows ───────────────────────────────────────────
  // EQ only allows one trade window open at a time.
  // Track a pending batch of "offered" items for the current window.
  // Only emit offered entries when their trade window ends in a completion.
  // Cancellations silently discard the batch.
  var entries       = [];
  var pendingOffers = [];
  var tradePartner  = null;

  for (var j = 0; j < rawEvents.length; j++) {
    var ev = rawEvents[j];

    if (ev.entryType === 'delivery') {
      entries.push(ev);
      continue;
    }

    if (ev.entryType === 'offered') {
      if (tradePartner && tradePartner !== ev.recipient) {
        pendingOffers = [];
      }
      tradePartner = ev.recipient;
      pendingOffers.push(ev);
      continue;
    }

    if (ev.entryType === 'trade_complete') {
      for (var k = 0; k < pendingOffers.length; k++) {
        pendingOffers[k].completeRawLine = ev.rawLine;
        entries.push(pendingOffers[k]);
      }
      pendingOffers = [];
      tradePartner  = null;
      continue;
    }

    // cancelled_self or cancelled_player — silently discard the pending batch
    if (ev.entryType === 'cancelled_self' || ev.entryType === 'cancelled_player') {
      pendingOffers = [];
      tradePartner  = null;
    }
  }
  // Any offers still pending at EOF had no resolution — discard them.

  self.postMessage({ type: 'done', entries: entries });
};

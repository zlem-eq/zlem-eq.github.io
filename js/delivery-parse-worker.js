// Web Worker — extracts delivery confirmation lines off the main thread.
// Input:  { file: File, handle: FileSystemFileHandle|null, tailDays: number|null }
//           tailDays > 0  → read only the tail of the file back `tailDays` days
//           tailDays falsy → read the entire file front-to-back
//           handle         → optional; lets us re-open the file if it changes mid-read
// Output: { type: 'progress', pct } | { type: 'done', entries: Array }
//         | { type: 'error', name: string, message: string }
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

var TAIL_CHUNK   = 4 * 1024 * 1024; // 4 MB per read
var MS_PER_DAY   = 24 * 60 * 60 * 1000;
var MAX_ATTEMPTS = 6;   // read attempts before giving up on a changing file
var RETRY_DELAY  = 150; // ms to let the writer settle before re-reading

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// EverQuest keeps the log open and appends to it, so the File snapshot handed to
// this worker can go stale, causing reads to throw NotReadableError. Retry a few
// times, refreshing the snapshot from the handle when one is available.
function isTransientReadError(err) {
  return err && (err.name === 'NotReadableError' || err.name === 'NotFoundError');
}

async function readSliceText(ctx, start, end) {
  for (var attempt = 1; ; attempt++) {
    try {
      return await ctx.file.slice(start, end).text();
    } catch (err) {
      if (!isTransientReadError(err) || attempt >= MAX_ATTEMPTS) throw err;
      await sleep(RETRY_DELAY);
      if (ctx.handle) {
        try { ctx.file = await ctx.handle.getFile(); } catch (e) { /* keep old snapshot */ }
      }
    }
  }
}

function parseEQDate(raw) {
  var p = raw.split(' ');
  var t = p[3].split(':');
  return new Date(+p[4], MONTHS[p[1]], +p[2], +t[0], +t[1], +t[2]);
}

// Parses a line already matched by LINE_RE. `date` may be passed in when the
// caller has already parsed it (tail scan); otherwise it is parsed on demand.
function parseMatchedLine(lineMatch, line, rawEvents, date) {
  var body = lineMatch[2].trim();
  var m;
  function getDate() { return date || parseEQDate(lineMatch[1]); }

  m = body.match(DELIVERY_RE);
  if (m) {
    rawEvents.push({ entryType: 'delivery', deliverer: m[1], rawMessage: m[2],
      item: m[3], recipient: m[4], timestamp: lineMatch[1],
      date: getDate(), rawLine: line });
    return;
  }

  m = body.match(OFFERED_RE);
  if (m) {
    rawEvents.push({ entryType: 'offered', item: m[1], recipient: m[2],
      timestamp: lineMatch[1], date: getDate(), rawLine: line });
    return;
  }

  m = body.match(TRADE_COMPLETE_RE);
  if (m) {
    rawEvents.push({ entryType: 'trade_complete', item: '', recipient: m[1],
      timestamp: lineMatch[1], date: getDate(), rawLine: line });
    return;
  }

  if (CANCELLED_YOU_RE.test(body)) {
    rawEvents.push({ entryType: 'cancelled_self', item: '', recipient: '',
      timestamp: lineMatch[1], date: getDate(), rawLine: line });
    return;
  }

  m = body.match(CANCELLED_PLR_RE);
  if (m) {
    rawEvents.push({ entryType: 'cancelled_player', item: '', recipient: m[1],
      timestamp: lineMatch[1], date: getDate(), rawLine: line });
  }
}

function parseLine(line, rawEvents) {
  var lineMatch = line.match(LINE_RE);
  if (lineMatch) parseMatchedLine(lineMatch, line, rawEvents, null);
}

// Full scan — read the whole file in forward chunks.
async function readFull(ctx) {
  var fileSize  = ctx.file.size;
  var rawEvents = [];
  var remainder = '';
  var offset    = 0;
  var lastPct   = 0;

  while (offset < fileSize) {
    var end  = Math.min(fileSize, offset + TAIL_CHUNK);
    var text = await readSliceText(ctx, offset, end);
    offset   = end;

    var lines = (remainder + text).split(/\r?\n/);
    remainder = lines.pop(); // last element may be an incomplete line

    for (var i = 0; i < lines.length; i++) parseLine(lines[i], rawEvents);

    var pct = Math.min(99, Math.round(offset / fileSize * 100));
    if (pct !== lastPct) {
      self.postMessage({ type: 'progress', pct: pct });
      lastPct = pct;
    }
  }

  if (remainder) parseLine(remainder, rawEvents);
  return rawEvents;
}

// Tail scan — read fixed-size chunks backward from EOF, stopping once a chunk
// reaches past the cutoff. EQ logs are append-only and chronological, so once a
// line older than the cutoff is seen, everything before it is older too.
// Events are returned in chronological order (required by the trade-window pass).
async function readTail(ctx, tailDays) {
  var cutoff   = Date.now() - tailDays * MS_PER_DAY;
  var fileSize = ctx.file.size;
  var chunks   = []; // per-chunk event arrays, newest chunk first
  var carry    = ''; // partial first line of the previously-read (newer) chunk
  var chunkEnd = fileSize;
  var reachedCutoff = false;

  while (chunkEnd > 0 && !reachedCutoff) {
    var chunkStart = Math.max(0, chunkEnd - TAIL_CHUNK);
    // Reattach the fragment from the newer chunk to the end of this chunk's text,
    // reconstructing the line that straddled the byte boundary.
    var text  = (await readSliceText(ctx, chunkStart, chunkEnd)) + carry;
    var lines = text.split(/\r?\n/);

    // The first line is partial whenever there is older data still to read.
    carry = chunkStart > 0 ? lines.shift() : '';

    var chunkEvents = [];
    for (var i = 0; i < lines.length; i++) {
      var lineMatch = lines[i].match(LINE_RE);
      if (!lineMatch) continue;
      var date = parseEQDate(lineMatch[1]);
      if (date.getTime() < cutoff) {          // older lines sit at the start of a chunk
        reachedCutoff = true;
        continue;
      }
      parseMatchedLine(lineMatch, lines[i], chunkEvents, date);
    }
    chunks.push(chunkEvents);

    var pct = Math.min(99, Math.round((fileSize - chunkStart) / fileSize * 100));
    self.postMessage({ type: 'progress', pct: pct });

    chunkEnd = chunkStart;
  }

  return [].concat.apply([], chunks.reverse());
}

// EQ only allows one trade window open at a time.
// Track a pending batch of "offered" items for the current window.
// Only emit offered entries when their trade window ends in a completion.
// Cancellations silently discard the batch.
function resolveTrades(rawEvents) {
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
  return entries;
}

self.onmessage = async function (e) {
  var ctx      = { file: e.data.file, handle: e.data.handle || null };
  var tailDays = e.data.tailDays;

  try {
    var rawEvents = tailDays
      ? await readTail(ctx, tailDays)
      : await readFull(ctx);
    self.postMessage({ type: 'done', entries: resolveTrades(rawEvents) });
  } catch (err) {
    self.postMessage({
      type: 'error',
      name: (err && err.name) || 'Error',
      message: (err && err.message) || String(err)
    });
  }
};

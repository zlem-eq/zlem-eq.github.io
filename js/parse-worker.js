// Web Worker — extracts loot entries from an EverQuest log file.
// Receives:  { file: File, playerName: string, tailDays: number|null }
//              tailDays > 0  → read only the tail of the file back `tailDays` days
//              tailDays falsy → read the entire file front-to-back
// Posts:     { type: 'progress', pct: 0-100 }  (periodic)
//            { type: 'done',     entries: Array }

var LOOT_RE = /^(?:--)?(.+?) (?:has|have) looted (\d+ )?(.+?) from (.+?)'s corpse\.(?:--)?$/;
var LINE_RE  = /^\[(\w{3} \w{3} \d{1,2} \d{2}:\d{2}:\d{2} \d{4})\] (.+)$/;
var MONTHS   = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };

var TAIL_CHUNK = 4 * 1024 * 1024; // 4 MB per backward read
var MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseEQDate(raw) {
  var p = raw.split(' ');
  var t = p[3].split(':');
  return new Date(+p[4], MONTHS[p[1]], +p[2], +t[0], +t[1], +t[2]);
}

function normalizeMobName(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function normalizeItemName(name) {
  return name.replace(/^(?:a|an|the) /i, '');
}

function buildEntry(lineMatch, lootMatch, playerName, date) {
  return {
    looter:    lootMatch[1] === 'You' ? playerName : lootMatch[1],
    qty:       lootMatch[2] ? parseInt(lootMatch[2].trim(), 10) : 1,
    item:      normalizeItemName(lootMatch[3]),
    mob:       normalizeMobName(lootMatch[4]),
    timestamp: lineMatch[1],
    date:      date,
    rawLine:   lineMatch.input
  };
}

// Returns a loot entry, or null. The date is parsed only for actual loot lines
// (logs are overwhelmingly non-loot lines, so parsing every date would be wasteful).
function parseLootLine(line, playerName) {
  var lineMatch = line.match(LINE_RE);
  if (!lineMatch) return null;
  var lootMatch = lineMatch[2].trim().match(LOOT_RE);
  if (!lootMatch) return null;
  return buildEntry(lineMatch, lootMatch, playerName, parseEQDate(lineMatch[1]));
}

// Full scan — stream the whole file line-by-line so large files don't exhaust memory.
async function parseFull(file, playerName) {
  var entries   = [];
  var fileSize  = file.size;
  var bytesRead = 0;
  var remainder = '';
  var lastPct   = 0;

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
      var entry = parseLootLine(lines[i], playerName);
      if (entry) entries.push(entry);
    }
  }

  if (remainder) {
    var last = parseLootLine(remainder, playerName);
    if (last) entries.push(last);
  }

  self.postMessage({ type: 'done', entries: entries });
}

// Tail scan — read fixed-size chunks backward from EOF, stopping once a chunk
// reaches past the cutoff. EQ logs are append-only and chronological, so once a
// line older than the cutoff is seen, everything before it is older too.
async function parseTail(file, playerName, tailDays) {
  var cutoff   = Date.now() - tailDays * MS_PER_DAY;
  var fileSize = file.size;
  var entries  = [];
  var carry    = ''; // partial first line of the previously-read (newer) chunk
  var chunkEnd = fileSize;
  var reachedCutoff = false;

  while (chunkEnd > 0 && !reachedCutoff) {
    var chunkStart = Math.max(0, chunkEnd - TAIL_CHUNK);
    // Reattach the fragment from the newer chunk to the end of this chunk's text,
    // reconstructing the line that straddled the byte boundary.
    var text  = (await file.slice(chunkStart, chunkEnd).text()) + carry;
    var lines = text.split(/\r?\n/);

    // The first line is partial whenever there is older data still to read.
    carry = chunkStart > 0 ? lines.shift() : '';

    for (var i = 0; i < lines.length; i++) {
      var lineMatch = lines[i].match(LINE_RE);
      if (!lineMatch) continue;                 // no timestamp on this line
      var date = parseEQDate(lineMatch[1]);
      if (date.getTime() < cutoff) {            // older lines sit at the start of a chunk
        reachedCutoff = true;
        continue;
      }
      var lootMatch = lineMatch[2].trim().match(LOOT_RE);
      if (lootMatch) entries.push(buildEntry(lineMatch, lootMatch, playerName, date));
    }

    var pct = Math.min(99, Math.round((fileSize - chunkStart) / fileSize * 100));
    self.postMessage({ type: 'progress', pct: pct });

    chunkEnd = chunkStart;
  }

  self.postMessage({ type: 'done', entries: entries });
}

self.onmessage = async function (e) {
  var file       = e.data.file;
  var playerName = e.data.playerName;
  var tailDays   = e.data.tailDays;

  if (tailDays) {
    await parseTail(file, playerName, tailDays);
  } else {
    await parseFull(file, playerName);
  }
};

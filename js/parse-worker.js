// Web Worker — streams the log file line-by-line so large files don't exhaust memory.
// Receives:  { file: File, playerName: string }
// Posts:     { type: 'progress', pct: 0-100 }  (periodic)
//            { type: 'done',     entries: Array }

var LOOT_RE = /^(?:--)?(.+?) (?:has|have) looted (\d+ )?(.+?) from (.+?)'s corpse\.(?:--)?$/;
var LINE_RE  = /^\[(\w{3} \w{3} \d{1,2} \d{2}:\d{2}:\d{2} \d{4})\] (.+)$/;
var MONTHS   = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };

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

function parseLine(line, playerName, entries) {
  var lineMatch = line.match(LINE_RE);
  if (!lineMatch) return;
  var lootMatch = lineMatch[2].trim().match(LOOT_RE);
  if (!lootMatch) return;
  entries.push({
    looter:    lootMatch[1] === 'You' ? playerName : lootMatch[1],
    qty:       lootMatch[2] ? parseInt(lootMatch[2].trim(), 10) : 1,
    item:      normalizeItemName(lootMatch[3]),
    mob:       normalizeMobName(lootMatch[4]),
    timestamp: lineMatch[1],
    date:      parseEQDate(lineMatch[1]),
    rawLine:   line
  });
}

self.onmessage = async function (e) {
  var file       = e.data.file;
  var playerName = e.data.playerName;
  var entries    = [];
  var fileSize   = file.size;
  var bytesRead  = 0;
  var remainder  = '';
  var lastPct    = 0;

  var reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();

  while (true) {
    var chunk = await reader.read();
    if (chunk.done) break;

    var text = chunk.value;
    // Approximate bytes read by UTF-8 encoding length of the decoded chunk
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
      parseLine(lines[i], playerName, entries);
    }
  }

  // Flush any remaining content after the last newline
  if (remainder) {
    parseLine(remainder, playerName, entries);
  }

  self.postMessage({ type: 'done', entries: entries });
};

// Web Worker — runs parseLog off the main thread so large files don't freeze the UI.
// Receives:  { buffer: ArrayBuffer, playerName: string }
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

self.onmessage = function (e) {
  var buffer     = e.data.buffer;
  var playerName = e.data.playerName;

  // Decode the ArrayBuffer to a string
  var text  = new TextDecoder().decode(buffer);
  var lines = text.split(/\r?\n/);
  var total = lines.length;

  var entries   = [];
  var lastPct   = 0;
  var CHUNK     = 50000;   // report progress every 50k lines

  for (var i = 0; i < total; i++) {
    // Progress update every CHUNK lines
    if (i > 0 && i % CHUNK === 0) {
      var pct = Math.round(i / total * 100);
      if (pct !== lastPct) {
        self.postMessage({ type: 'progress', pct: pct });
        lastPct = pct;
      }
    }

    var lineMatch = lines[i].match(LINE_RE);
    if (!lineMatch) continue;

    var lootMatch = lineMatch[2].trim().match(LOOT_RE);
    if (!lootMatch) continue;

    entries.push({
      looter:    lootMatch[1] === 'You' ? playerName : lootMatch[1],
      qty:       lootMatch[2] ? parseInt(lootMatch[2].trim(), 10) : 1,
      item:      normalizeItemName(lootMatch[3]),
      mob:       normalizeMobName(lootMatch[4]),
      timestamp: lineMatch[1],
      date:      parseEQDate(lineMatch[1]),
      rawLine:   lines[i]
    });
  }

  self.postMessage({ type: 'done', entries: entries });
};

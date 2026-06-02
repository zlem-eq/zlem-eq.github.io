// Web Worker — parses delivery confirmation lines off the main thread.
// Input:  { buffer: ArrayBuffer }
// Output: { type: 'progress', pct } | { type: 'done', entries: Array }
//
// Matches lines like:
//   [Fri May 29 13:35:54 2026] Nablea told you, 'I will deliver the Money (300p) to Digdug as soon as possible!'

var LINE_RE     = /^\[(\w{3} \w{3} \d{1,2} \d{2}:\d{2}:\d{2} \d{4})\] (.+)$/;
var DELIVERY_RE = /^(\w+) told you, '(I will deliver the (.+?) to (\w+) as soon as possible!)'/;
var MONTHS      = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };

function parseEQDate(raw) {
  var p = raw.split(' ');
  var t = p[3].split(':');
  return new Date(+p[4], MONTHS[p[1]], +p[2], +t[0], +t[1], +t[2]);
}

self.onmessage = function (e) {
  var buffer = e.data.buffer;
  var text   = new TextDecoder().decode(buffer);
  var lines  = text.split(/\r?\n/);
  var total  = lines.length;
  var entries = [];
  var lastPct = 0;
  var CHUNK   = 50000;

  for (var i = 0; i < total; i++) {
    if (i > 0 && i % CHUNK === 0) {
      var pct = Math.round(i / total * 100);
      if (pct !== lastPct) { self.postMessage({ type: 'progress', pct: pct }); lastPct = pct; }
    }

    var lineMatch = lines[i].match(LINE_RE);
    if (!lineMatch) continue;

    var bodyMatch = lineMatch[2].trim().match(DELIVERY_RE);
    if (!bodyMatch) continue;

    entries.push({
      deliverer:  bodyMatch[1],
      rawMessage: bodyMatch[2],
      item:       bodyMatch[3],
      recipient:  bodyMatch[4],
      timestamp:  lineMatch[1],
      date:       parseEQDate(lineMatch[1])
    });
  }

  self.postMessage({ type: 'done', entries: entries });
};

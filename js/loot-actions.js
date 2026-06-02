(function () {
  // ── Helpers ────────────────────────────────────────────────────────────────
  function normalizeItemName(name) {
    return name.trim().replace(/^(?:a|an|the) /i, '').toLowerCase();
  }

  // Wrap text in a Discord inline code span.
  // When the text contains a backtick, use double-backtick delimiters with
  // space padding: `` `item` `` — this is valid CommonMark and renders correctly
  // in Discord, keeping the code-span appearance for all item names.
  function discordCode(text) {
    if (text.indexOf('`') !== -1) {
      return '`` ' + text + ' ``';
    }
    return '`' + text + '`';
  }

  // Escape characters that break Discord markdown outside of code spans.
  function discordEscape(text) {
    return text.replace(/([*_~`\\|])/g, '\\$1');
  }

  // Split text into chunks of at most maxLen chars, breaking only at newlines.
  function chunkByLines(text, maxLen) {
    var lines   = text.split('\n');
    var chunks  = [];
    var current = '';
    lines.forEach(function (line) {
      var next = current ? current + '\n' + line : line;
      if (next.length > maxLen && current !== '') {
        chunks.push(current);
        current = line;
      } else {
        current = next;
      }
    });
    if (current) chunks.push(current);
    return chunks;
  }

  // Render one copy-able pre block per chunk into container.
  function renderChunks(container, text, maxLen) {
    container.innerHTML = '';
    var chunks = chunkByLines(text, maxLen);
    var total  = chunks.length;
    chunks.forEach(function (chunk, i) {
      var wrap = document.createElement('div');
      wrap.className = 'chunk-block';

      if (total > 1) {
        var lbl = document.createElement('div');
        lbl.className = 'chunk-label';
        lbl.textContent = 'Part ' + (i + 1) + ' of ' + total;
        wrap.appendChild(lbl);
      }

      var hdr = document.createElement('div');
      hdr.className = 'output-box-header';

      var charCount = document.createElement('span');
      charCount.className = 'output-box-label';
      charCount.textContent = chunk.length + ' chars';

      var copyBtn = document.createElement('button');
      copyBtn.className = 'btn-copy';
      copyBtn.textContent = '📋 Copy';
      (function (btn, txt) {
        btn.addEventListener('click', function () { copyText(txt, btn); });
      })(copyBtn, chunk);

      hdr.appendChild(charCount);
      hdr.appendChild(copyBtn);

      var pre = document.createElement('pre');
      pre.className = 'output-text delivery-output-pre';
      pre.textContent = chunk;

      wrap.appendChild(hdr);
      wrap.appendChild(pre);
      container.appendChild(wrap);
    });
  }

  // Returns [{mob, item, looter, qty}] for all checked mobs+items across all pages.
  // Uses window.getCheckedLoot (set by parser.js) for off-page mob state, then
  // overlays per-item checkbox state from the currently visible DOM rows.
  function getCheckedItems() {
    // Build a set of unchecked item keys from visible DOM rows (item\0looter)
    var uncheckedKeys = new Set();
    document.querySelectorAll('.loot-table tbody tr').forEach(function (row) {
      var rowCb = row.querySelector('.loot-checkbox');
      if (rowCb && !rowCb.checked) {
        var cells = row.cells;
        uncheckedKeys.add(cells[1].textContent.trim() + '\x00' + cells[3].textContent.trim());
      }
    });

    var base = window.getCheckedLoot ? window.getCheckedLoot() : [];
    return base.filter(function (entry) {
      return !uncheckedKeys.has(entry.item + '\x00' + entry.looter);
    });
  }

  // ── Copy helper ────────────────────────────────────────────────────────────
  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(function () {
      var orig = btn.textContent;
      btn.textContent = '✓ Copied!';
      setTimeout(function () { btn.textContent = orig; }, 1800);
    });
  }

  // ── Modal helpers ──────────────────────────────────────────────────────────
  function openModal(el)  { el.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
  function closeModal(el) { el.classList.add('hidden');    document.body.style.overflow = ''; }

  // ════════════════════════════════════════════════════════════════════════════
  // 1. GENERATE OPENDKP LOOT LIST
  // ════════════════════════════════════════════════════════════════════════════
  var genOpenDkpBtn  = document.getElementById('gen-opendkp-btn');
  var openDkpOutput  = document.getElementById('opendkp-output');
  var openDkpText    = document.getElementById('opendkp-text');
  var copyOpenDkpBtn = document.getElementById('copy-opendkp-btn');

  genOpenDkpBtn.addEventListener('click', function () {
    var items = getCheckedItems();
    if (items.length === 0) {
      openDkpText.textContent = '(No checked items found — select at least one mob and item.)';
      openDkpOutput.classList.remove('hidden');
      return;
    }
    var parts = [];
    items.forEach(function (i) {
      for (var j = 0; j < i.qty; j++) parts.push(i.item);
    });
    var str = parts.join('|');
    openDkpText.textContent = str;
    openDkpOutput.classList.remove('hidden');
    openDkpOutput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  copyOpenDkpBtn.addEventListener('click', function () {
    copyText(openDkpText.textContent, copyOpenDkpBtn);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 2. GENERATE LOOT DELIVERY LIST
  // ════════════════════════════════════════════════════════════════════════════
  var genDeliveryBtn        = document.getElementById('gen-delivery-btn');
  var deliveryModal         = document.getElementById('delivery-modal');
  var deliveryModalClose    = document.getElementById('delivery-modal-close');
  var deliveryPaste         = document.getElementById('delivery-paste');
  var deliveryGenerateBtn   = document.getElementById('delivery-generate-btn');

  var deliveryOutputModal    = document.getElementById('delivery-output-modal');
  var deliveryOutputClose    = document.getElementById('delivery-output-close');
  var deliveryOutputClose2   = document.getElementById('delivery-output-close2');
  var deliveryOutputBack     = document.getElementById('delivery-output-back');
  var deliveryChunksContainer = document.getElementById('delivery-chunks-container');
  var deliveryOutputSummary  = document.getElementById('delivery-output-summary');

  genDeliveryBtn.addEventListener('click', function () {
    deliveryPaste.value = '';
    openModal(deliveryModal);
    deliveryPaste.focus();
  });

  deliveryModalClose.addEventListener('click', function () { closeModal(deliveryModal); });
  deliveryModal.addEventListener('click', function (e) { if (e.target === deliveryModal) closeModal(deliveryModal); });

  deliveryOutputClose.addEventListener('click',  function () { closeModal(deliveryOutputModal); });
  deliveryOutputClose2.addEventListener('click', function () { closeModal(deliveryOutputModal); });
  deliveryOutputBack.addEventListener('click', function () {
    closeModal(deliveryOutputModal);
    openModal(deliveryModal);
  });
  deliveryOutputModal.addEventListener('click', function (e) {
    if (e.target === deliveryOutputModal) closeModal(deliveryOutputModal);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!deliveryModal.classList.contains('hidden'))       closeModal(deliveryModal);
    if (!deliveryOutputModal.classList.contains('hidden')) closeModal(deliveryOutputModal);
  });

  deliveryGenerateBtn.addEventListener('click', function () {
    var output = generateDeliveryList(deliveryPaste.value.trim());
    deliveryOutputSummary.textContent = output.summary;
    renderChunks(deliveryChunksContainer, output.text, 1900);
    closeModal(deliveryModal);
    openModal(deliveryOutputModal);
  });

  // ── Core delivery list generation ──────────────────────────────────────────
  function parsePastedLine(line) {
    // Format: "Item Name;DKP;Winner gratss"  (or "Winner" without "gratss")
    var parts = line.split(';');
    if (parts.length < 2) return null;
    var itemRaw = parts[0].trim();
    var dkp     = parts[1] ? parts[1].trim() : '?';
    var winRaw  = parts[2] ? parts[2].trim() : '';
    // Strip trailing " gratss" (case-insensitive) to get just the winner name
    var winner  = winRaw.replace(/\s+gratss\s*$/i, '').trim() || '(unknown)';
    return { itemRaw: itemRaw, dkp: dkp, winner: winner };
  }

  function generateDeliveryList(pasteText) {
    var checkedItems = getCheckedItems();

    // Build lookup: normalizedItemName → [{item, looter, mob}]
    var raidMap = {};
    checkedItems.forEach(function (ci) {
      var key = normalizeItemName(ci.item);
      if (!raidMap[key]) raidMap[key] = [];
      raidMap[key].push(ci);
    });

    // Parse pasted lines
    var pastedEntries = [];
    pasteText.split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var parsed = parsePastedLine(line);
      if (parsed) pastedEntries.push(parsed);
    });

    var matched    = [];
    var noDelivery = [];

    pastedEntries.forEach(function (entry) {
      var key  = normalizeItemName(entry.itemRaw);
      var hits = raidMap[key];
      if (hits && hits.length > 0) {
        // Prefer a match where the winner already holds the item (self-delivery)
        var hit = hits.find(function (h) { return !h._used && h.looter === entry.winner; })
               || hits.find(function (h) { return !h._used; })
               || hits[hits.length - 1];
        hit._used = true;
        matched.push({ entry: entry, looter: hit.looter, mob: hit.mob, item: hit.item });
      } else {
        noDelivery.push(entry);
      }
    });

    var unassigned = checkedItems.filter(function (ci) { return !ci._used; });

    // ── Group matched items by deliverer (looter), sorted alphabetically ─────
    var byDeliverer = {};
    matched.forEach(function (m) {
      if (!byDeliverer[m.looter]) byDeliverer[m.looter] = [];
      byDeliverer[m.looter].push(m);
    });
    var deliverers = Object.keys(byDeliverer).sort(function (a, b) {
      return a.toLowerCase().localeCompare(b.toLowerCase());
    });

    // ── Build Discord-formatted output ────────────────────────────────────────
    var lines = [];
    var divider = '─'.repeat(40);

    lines.push('📦 **LOOT DELIVERY LIST**');
    lines.push('*Generated: ' + new Date().toLocaleString() + '*');
    lines.push('');

    if (deliverers.length > 0) {
      deliverers.forEach(function (deliverer) {
        var items = byDeliverer[deliverer];
        var label = items.length === 1 ? '1 delivery' : items.length + ' deliveries';
        lines.push('**' + discordEscape(deliverer) + '** — ' + label);
        items.forEach(function (m) {
          var selfDelivery = m.looter === m.entry.winner;
          var arrow = selfDelivery
            ? '→ **' + discordEscape(m.entry.winner) + '** *(already has it)*'
            : '→ **' + discordEscape(m.entry.winner) + '**';
          lines.push('> ' + discordCode(m.entry.itemRaw) + ' ' + arrow);
        });
        lines.push('');
      });
    } else {
      lines.push('*(No matched items)*');
      lines.push('');
    }

    if (noDelivery.length > 0) {
      lines.push(divider);
      lines.push('⚠️ **No Delivery Player Found** (' + noDelivery.length + ')');
      noDelivery.forEach(function (e) {
        lines.push('> ' + discordCode(e.itemRaw) + ' → **' + discordEscape(e.winner) + '**');
      });
      lines.push('');
    }

    if (unassigned.length > 0) {
      lines.push(divider);
      lines.push('📋 **Unassigned Raid Items** (' + unassigned.length + ')');
      unassigned.forEach(function (ci) {
        lines.push('> ' + discordCode(ci.item) + ' looted by **' + discordEscape(ci.looter) + '** [' + discordEscape(ci.mob) + ']');
      });
      lines.push('');
    }

    // Clean up _used flags
    checkedItems.forEach(function (ci) { delete ci._used; });

    var summary = matched.length + ' matched';
    if (noDelivery.length)  summary += ' · ' + noDelivery.length  + ' missing delivery player';
    if (unassigned.length)  summary += ' · ' + unassigned.length  + ' unassigned raid items';

    return { text: lines.join('\n'), summary: summary };
  }
})();

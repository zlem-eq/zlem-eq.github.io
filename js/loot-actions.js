(function () {
  // ── Helpers ────────────────────────────────────────────────────────────────
  function normalizeItemName(name) {
    return name.trim().replace(/^(?:a|an|the) /i, '').toLowerCase();
  }

  // Wrap text in a Discord code span, handling embedded backticks by switching
  // to double-backtick delimiters (`` text ``) when needed.
  function discordCode(text) {
    if (text.indexOf('`') !== -1) {
      // Double-backtick delimiters require a space when text starts/ends with a backtick
      var needsSpace = text.charAt(0) === '`' || text.charAt(text.length - 1) === '`';
      return needsSpace ? '`` ' + text + ' ``' : '``' + text + '``';
    }
    return '`' + text + '`';
  }

  // Escape characters that break Discord markdown outside of code spans.
  function discordEscape(text) {
    return text.replace(/([*_~`\\|])/g, '\\$1');
  }

  // Read every checked item from every checked mob out of the current DOM.
  // Returns [{mob, item, looter, qty}]
  function getCheckedItems() {
    var results = [];
    document.querySelectorAll('.mob-entry').forEach(function (entry) {
      var mobCb = entry.querySelector('.mob-checkbox');
      if (!mobCb || !mobCb.checked) return;
      var mobName = entry.querySelector('.mob-name').textContent.trim();
      entry.querySelectorAll('.loot-table tbody tr').forEach(function (row) {
        var rowCb = row.querySelector('.loot-checkbox');
        if (!rowCb || !rowCb.checked) return;
        var cells = row.cells;
        results.push({
          mob:    mobName,
          item:   cells[1].textContent.trim(),
          qty:    parseInt(cells[2].textContent.replace('x', '').trim(), 10) || 1,
          looter: cells[3].textContent.trim()
        });
      });
    });
    return results;
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
    var str = items.map(function (i) { return i.item; }).join('|');
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

  var deliveryOutputModal   = document.getElementById('delivery-output-modal');
  var deliveryOutputClose   = document.getElementById('delivery-output-close');
  var deliveryOutputClose2  = document.getElementById('delivery-output-close2');
  var deliveryOutputBack    = document.getElementById('delivery-output-back');
  var deliveryOutputText    = document.getElementById('delivery-output-text');
  var deliveryOutputSummary = document.getElementById('delivery-output-summary');
  var copyDeliveryBtn       = document.getElementById('copy-delivery-btn');

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

  copyDeliveryBtn.addEventListener('click', function () {
    copyText(deliveryOutputText.textContent, copyDeliveryBtn);
  });

  deliveryGenerateBtn.addEventListener('click', function () {
    var output = generateDeliveryList(deliveryPaste.value.trim());
    deliveryOutputText.textContent = output.text;
    deliveryOutputSummary.textContent = output.summary;
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
        var hit = hits.find(function (h) { return !h._used; }) || hits[hits.length - 1];
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
          lines.push('> ' + discordCode(m.entry.itemRaw) + ' → **' + discordEscape(m.entry.winner) + '**');
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

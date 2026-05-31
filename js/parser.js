(function () {
  // Matches both wrapped and unwrapped loot line variants:
  //   --Gindorf has looted a Chunk of Meat from a skeleton's corpse.--
  //   Vicious has looted a Spell: Focus of Spirit from The Avatar of War's corpse.
  const LOOT_RE = /^(?:--)?(.+?) (?:has|have) looted (\d+ )?(.+?) from (.+?)'s corpse\.(?:--)?$/;

  // EQ log line timestamp: [Day Mon DD HH:MM:SS YYYY]
  const LINE_RE = /^\[(\w{3} \w{3} \d{1,2} \d{2}:\d{2}:\d{2} \d{4})\] (.+)$/;

  const MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };

  const uploadZone    = document.getElementById('upload-zone');
  const fileInput     = document.getElementById('file-input');
  const resultsSection = document.getElementById('results-section');
  const emptyState    = document.getElementById('empty-state');
  const mobList       = document.getElementById('mob-list');
  const resultsSummary = document.getElementById('results-summary');
  const expandAllBtn  = document.getElementById('expand-all-btn');
  const selectAllBtn  = document.getElementById('select-all-btn');
  const deselectAllBtn = document.getElementById('deselect-all-btn');
  const resetBtn      = document.getElementById('reset-btn');

  let allExpanded = false;
  const customRange   = document.getElementById('custom-range');
  const rangeFrom     = document.getElementById('range-from');
  const rangeTo       = document.getElementById('range-to');

  // All parsed loot entries across the full file
  let allEntries = [];  // [{looter, qty, item, mob, timestamp, date}]
  let latestDate = null;
  let activeFilter = 'all';

  // ── Drag-and-drop styling ──────────────────────────────────────────────────
  uploadZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });
  uploadZone.addEventListener('dragleave', function () {
    uploadZone.classList.remove('drag-over');
  });
  uploadZone.addEventListener('drop', function (e) {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files[0]) processFile(fileInput.files[0]);
  });

  expandAllBtn.addEventListener('click', function () {
    allExpanded = !allExpanded;
    document.querySelectorAll('.mob-entry').forEach(function (entry) {
      entry.classList.toggle('open', allExpanded);
    });
    expandAllBtn.innerHTML = allExpanded ? '&#9650; Collapse all' : '&#9660; Expand all';
  });

  resetBtn.addEventListener('click', function () {
    resultsSection.classList.add('hidden');
    emptyState.classList.add('hidden');
    uploadZone.classList.remove('hidden');
    mobList.innerHTML = '';
    fileInput.value = '';
    allEntries = [];
    latestDate = null;
    activeFilter = 'all';
    allExpanded = false;
    expandAllBtn.innerHTML = '&#9660; Expand all';
    setActivePill('all');
    customRange.classList.add('hidden');
  });

  selectAllBtn.addEventListener('click', function () {
    document.querySelectorAll('.mob-checkbox').forEach(function (cb) {
      cb.checked = true;
      cb.closest('.mob-entry').classList.add('selected');
    });
  });

  deselectAllBtn.addEventListener('click', function () {
    document.querySelectorAll('.mob-checkbox').forEach(function (cb) {
      cb.checked = false;
      cb.closest('.mob-entry').classList.remove('selected');
    });
  });

  // ── Filter pills ───────────────────────────────────────────────────────────
  document.querySelectorAll('.filter-pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      activeFilter = pill.dataset.filter;
      setActivePill(activeFilter);

      if (activeFilter === 'custom') {
        customRange.classList.remove('hidden');
        // Pre-fill inputs from the log's date range if empty
        if (!rangeFrom.value && latestDate) {
          const from = new Date(latestDate.getTime() - 8 * 60 * 60 * 1000);
          rangeFrom.value = toDatetimeLocal(from);
          rangeTo.value   = toDatetimeLocal(latestDate);
        }
        applyFilter();
      } else {
        customRange.classList.add('hidden');
        applyFilter();
      }
    });
  });

  rangeFrom.addEventListener('input', applyFilter);
  rangeTo.addEventListener('input', applyFilter);

  function setActivePill(filter) {
    document.querySelectorAll('.filter-pill').forEach(function (p) {
      p.classList.toggle('active', p.dataset.filter === filter);
    });
  }

  // ── File processing ────────────────────────────────────────────────────────
  let playerName = 'You';

  function extractPlayerName(filename) {
    // eqlog_PlayerName_ServerName.txt  →  PlayerName
    const m = filename.match(/^eqlog_(.+?)_[^_]+\.txt$/i);
    return m ? m[1] : 'You';
  }

  function processFile(file) {
    playerName = extractPlayerName(file.name);
    const reader = new FileReader();
    reader.onload = function (e) {
      allEntries = parseLog(e.target.result);
      latestDate = allEntries.length
        ? allEntries.reduce(function (max, entry) {
            return entry.date > max ? entry.date : max;
          }, allEntries[0].date)
        : null;

      activeFilter = 'all';
      setActivePill('all');
      customRange.classList.add('hidden');
      applyFilter();
    };
    reader.readAsText(file);
  }

  // ── Parsing ────────────────────────────────────────────────────────────────
  function parseEQDate(raw) {
    // "Wed May 27 15:08:29 2026"
    const parts = raw.split(' ');
    const mon  = MONTHS[parts[1]];
    const day  = parseInt(parts[2], 10);
    const year = parseInt(parts[4], 10);
    const time = parts[3].split(':');
    return new Date(year, mon, day, parseInt(time[0],10), parseInt(time[1],10), parseInt(time[2],10));
  }

  function parseLog(text) {
    const entries = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lineMatch = lines[i].match(LINE_RE);
      if (!lineMatch) continue;

      const timestamp = lineMatch[1];
      const body      = lineMatch[2].trim();
      const lootMatch = body.match(LOOT_RE);
      if (!lootMatch) continue;

      entries.push({
        looter:    lootMatch[1] === 'You' ? playerName : lootMatch[1],
        qty:       lootMatch[2] ? parseInt(lootMatch[2].trim(), 10) : 1,
        item:      normalizeItemName(lootMatch[3]),
        mob:       normalizeMobName(lootMatch[4]),
        timestamp: timestamp,
        date:      parseEQDate(timestamp),
      });
    }
    return entries;
  }

  // ── Filtering & grouping ───────────────────────────────────────────────────
  function applyFilter() {
    let filtered = allEntries;

    if (activeFilter !== 'all' && latestDate) {
      let fromDate, toDate;

      if (activeFilter === 'custom') {
        fromDate = rangeFrom.value ? new Date(rangeFrom.value) : null;
        toDate   = rangeTo.value   ? new Date(rangeTo.value)   : null;
      } else {
        const hours = activeFilter === '1h' ? 1 : activeFilter === '8h' ? 8 : 24;
        toDate   = latestDate;
        fromDate = new Date(latestDate.getTime() - hours * 60 * 60 * 1000);
      }

      filtered = allEntries.filter(function (e) {
        if (fromDate && e.date < fromDate) return false;
        if (toDate   && e.date > toDate)   return false;
        return true;
      });
    }

    // Snapshot total loot count before raid-target filter for empty-state messaging
    var totalBeforeTargetFilter = filtered.length;

    // Filter to known raid targets only
    var targetSet = window.RaidTargets ? window.RaidTargets.getSet() : null;
    if (targetSet) {
      filtered = filtered.filter(function (e) {
        return targetSet[e.mob.toLowerCase()];
      });
    }

    renderResults(groupByMob(filtered), totalBeforeTargetFilter);
  }

  // Expose so the modal's Save button can trigger a re-filter without reloading the file
  window.reapplyFilter = applyFilter;

  function groupByMob(entries) {
    const mobs = new Map();
    entries.forEach(function (entry) {
      if (!mobs.has(entry.mob)) mobs.set(entry.mob, { rows: new Map() });
      const rows = mobs.get(entry.mob).rows;
      // Key on item + looter so the same item looted by different people stays separate
      const key = entry.item + '\x00' + entry.looter;
      if (rows.has(key)) {
        rows.get(key).qty += entry.qty;
      } else {
        rows.set(key, { looter: entry.looter, qty: entry.qty, item: entry.item, timestamp: entry.timestamp });
      }
    });

    // Convert inner Maps to arrays and sort mobs alphabetically
    const result = new Map();
    [...mobs.entries()]
      .sort(function (a, b) { return a[0].localeCompare(b[0]); })
      .forEach(function (pair) {
        result.set(pair[0], { entries: [...pair[1].rows.values()] });
      });
    return result;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function normalizeMobName(name) {
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  // Strip leading articles so "a Bone Chips" and "Bone Chips" aggregate together.
  // EQ omits the article in log lines when qty > 1.
  function normalizeItemName(name) {
    return name.replace(/^(?:a|an|the) /i, '');
  }

  function formatTimestamp(raw) {
    // "Wed May 27 15:08:29 2026" → "May 27 15:08:29"
    const parts = raw.split(' ');
    return parts[1] + ' ' + parts[2] + ' ' + parts[3];
  }

  function toDatetimeLocal(d) {
    // Returns "YYYY-MM-DDTHH:MM" for datetime-local input value
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) +
           'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  function renderResults(mobs, totalBeforeTargetFilter) {
    uploadZone.classList.add('hidden');
    mobList.innerHTML = '';
    emptyState.classList.add('hidden');
    allExpanded = false;
    expandAllBtn.innerHTML = '&#9660; Expand all';

    if (mobs.size === 0) {
      if (totalBeforeTargetFilter > 0) {
        emptyState.innerHTML =
          '&#128269; No loot from raid targets found in this time window.<br>' +
          '<span style="font-size:0.85em">' + totalBeforeTargetFilter + ' non-raid loot ' +
          (totalBeforeTargetFilter === 1 ? 'entry was' : 'entries were') +
          ' filtered out. Check <b>Edit Raid Targets</b> if a mob is missing from the list.</span>';
      } else if (allEntries.length > 0) {
        emptyState.innerHTML =
          '&#128269; No loot entries match the selected time window.';
      } else {
        emptyState.innerHTML =
          '&#128196; No loot entries found in this log file.';
      }
      emptyState.classList.remove('hidden');
      resultsSummary.textContent = '0 mobs · 0 loot entries';
      resultsSection.classList.remove('hidden');
      return;
    }

    let totalItems = 0;
    mobs.forEach(function (data) { totalItems += data.entries.length; });
    resultsSummary.textContent =
      mobs.size + ' mob' + (mobs.size !== 1 ? 's' : '') +
      ' · ' + totalItems + ' loot ' + (totalItems !== 1 ? 'entries' : 'entry');

    mobs.forEach(function (data, mobName) {
      mobList.appendChild(buildMobEntry(mobName, data.entries));
    });

    resultsSection.classList.remove('hidden');
  }

  function buildMobEntry(mobName, entries) {
    const li = document.createElement('li');
    li.className = 'mob-entry';

    const header = document.createElement('div');
    header.className = 'mob-header';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'mob-checkbox';
    cb.setAttribute('aria-label', 'Select ' + mobName);
    cb.addEventListener('change', function (e) {
      e.stopPropagation();
      li.classList.toggle('selected', cb.checked);
    });

    const nameEl = document.createElement('span');
    nameEl.className = 'mob-name';
    nameEl.textContent = mobName;

    const countEl = document.createElement('span');
    countEl.className = 'mob-count';
    countEl.textContent = entries.length + ' item' + (entries.length !== 1 ? 's' : '');

    const chevron = document.createElement('span');
    chevron.className = 'mob-chevron';
    chevron.textContent = '▶';

    header.appendChild(cb);
    header.appendChild(nameEl);
    header.appendChild(countEl);
    header.appendChild(chevron);

    header.addEventListener('click', function (e) {
      if (e.target === cb) return;
      li.classList.toggle('open');
    });

    const panel = document.createElement('div');
    panel.className = 'loot-panel';

    const table = document.createElement('table');
    table.className = 'loot-table';

    const thead = document.createElement('thead');
    thead.innerHTML =
      '<tr>' +
        '<th>Item</th>' +
        '<th>Qty</th>' +
        '<th>Looted by</th>' +
        '<th>Time</th>' +
      '</tr>';

    const tbody = document.createElement('tbody');
    entries.forEach(function (entry) {
      const tr = document.createElement('tr');

      const tdItem = document.createElement('td');
      tdItem.textContent = entry.item;

      const tdQty = document.createElement('td');
      tdQty.className = 'loot-qty';
      tdQty.textContent = 'x' + entry.qty;

      const tdLooter = document.createElement('td');
      if (entry.looter === playerName) {
        const em = document.createElement('span');
        em.className = 'looter-you';
        em.textContent = playerName;
        tdLooter.appendChild(em);
      } else {
        tdLooter.textContent = entry.looter;
      }

      const tdTime = document.createElement('td');
      tdTime.className = 'loot-timestamp';
      tdTime.textContent = formatTimestamp(entry.timestamp);

      tr.appendChild(tdItem);
      tr.appendChild(tdQty);
      tr.appendChild(tdLooter);
      tr.appendChild(tdTime);
      tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    panel.appendChild(table);

    li.appendChild(header);
    li.appendChild(panel);
    return li;
  }
})();

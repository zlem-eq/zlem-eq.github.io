(function () {
  const uploadZone          = document.getElementById('upload-zone');
  const processingOverlay   = document.getElementById('processing-overlay');
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

  // ── Drag-and-drop ──────────────────────────────────────────────────────────
  // ── Drag-and-drop ──────────────────────────────────────────────────────────
  // Block the browser's default "navigate to file" behavior for ANY drop on the
  // document. Without this, dropping a file even slightly outside the upload
  // zone causes a full-page navigation and the parse never completes.
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && !uploadZone.classList.contains('hidden')) {
      processFile(file);
    }
  });

  // Upload-zone hover styling only (drop is handled at document level above)
  uploadZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });
  uploadZone.addEventListener('dragleave', function () {
    uploadZone.classList.remove('drag-over');
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
    processingOverlay.classList.add('hidden');
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
  let parseWorker = null;

  const processingLabel = processingOverlay.querySelector('.processing-label');

  function extractPlayerName(filename) {
    const m = filename.match(/^eqlog_(.+?)_[^_]+\.txt$/i);
    return m ? m[1] : 'You';
  }

  function processFile(file) {
    playerName = extractPlayerName(file.name);
    uploadZone.classList.add('hidden');
    resultsSection.classList.add('hidden');
    emptyState.classList.add('hidden');
    processingLabel.textContent = 'Parsing log file…';
    processingOverlay.classList.remove('hidden');

    // Terminate any in-flight worker before starting a new one
    if (parseWorker) { parseWorker.terminate(); }
    parseWorker = new Worker('../js/parse-worker.js');

    parseWorker.onmessage = function (e) {
      if (e.data.type === 'progress') {
        processingLabel.textContent = 'Parsing log file… ' + e.data.pct + '%';
        return;
      }

      // type === 'done'
      // Dates arrive as numbers (serialised through postMessage) — restore them
      allEntries = e.data.entries.map(function (entry) {
        entry.date = new Date(entry.date);
        return entry;
      });

      latestDate = allEntries.length
        ? allEntries.reduce(function (max, entry) {
            return entry.date > max ? entry.date : max;
          }, allEntries[0].date)
        : null;

      activeFilter = 'all';
      allExpanded = false;
      expandAllBtn.innerHTML = '&#9660; Expand all';
      setActivePill('all');
      customRange.classList.add('hidden');
      processingOverlay.classList.add('hidden');
      applyFilter();
    };

    parseWorker.onerror = function (err) {
      processingOverlay.classList.add('hidden');
      uploadZone.classList.remove('hidden');
      console.error('Parse worker error:', err);
    };

    // Read as ArrayBuffer and transfer ownership to the worker (zero-copy)
    const reader = new FileReader();
    reader.onload = function (e) {
      parseWorker.postMessage(
        { buffer: e.target.result, playerName: playerName },
        [e.target.result]   // transferable — avoids copying the buffer
      );
    };
    reader.readAsArrayBuffer(file);
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
        '<th class="col-check"></th>' +
        '<th>Item</th>' +
        '<th>Qty</th>' +
        '<th>Looted by</th>' +
        '<th>Time</th>' +
      '</tr>';

    const tbody = document.createElement('tbody');
    entries.forEach(function (entry) {
      const tr = document.createElement('tr');

      const tdCheck = document.createElement('td');
      tdCheck.className = 'col-check';
      const rowCb = document.createElement('input');
      rowCb.type = 'checkbox';
      rowCb.className = 'loot-checkbox';
      rowCb.checked = true;
      rowCb.addEventListener('click', function (e) { e.stopPropagation(); });
      tdCheck.appendChild(rowCb);

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

      tr.appendChild(tdCheck);
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

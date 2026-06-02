(function () {
  const uploadZone          = document.getElementById('upload-zone');
  const processingOverlay   = document.getElementById('processing-overlay');
  const fileInput           = document.getElementById('file-input');
  const resultsSection      = document.getElementById('results-section');
  const emptyState          = document.getElementById('empty-state');
  const mobList             = document.getElementById('mob-list');
  const resultsSummary      = document.getElementById('results-summary');
  const expandAllBtn        = document.getElementById('expand-all-btn');
  const selectAllBtn        = document.getElementById('select-all-btn');
  const deselectAllBtn      = document.getElementById('deselect-all-btn');
  const resetBtn            = document.getElementById('reset-btn');
  const mobPaginationBar    = document.getElementById('mob-pagination-bar');
  const mobPagePrev         = document.getElementById('mob-page-prev');
  const mobPageNext         = document.getElementById('mob-page-next');
  const mobPageInfo         = document.getElementById('mob-page-info');

  let allExpanded = false;
  const customRange   = document.getElementById('custom-range');
  const rangeFrom     = document.getElementById('range-from');
  const rangeTo       = document.getElementById('range-to');

  // All parsed loot entries across the full file
  let allEntries = [];  // [{looter, qty, item, mob, timestamp, date}]
  let latestDate = null;
  let activeFilter = 'all';

  // Mob list pagination + persistent selection/expansion state
  let currentMobs   = new Map(); // full mobs map after filtering
  let mobPage       = 0;
  let mobPageSize   = 10;
  let openMobs      = new Set(); // displayNames of expanded mobs
  let selectedMobs  = new Set(); // displayNames of checked mobs

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
    if (allExpanded) {
      currentMobs.forEach(function (_, name) { openMobs.add(name); });
    } else {
      openMobs.clear();
    }
    document.querySelectorAll('.mob-entry').forEach(function (entry) {
      entry.classList.toggle('open', allExpanded);
    });
    expandAllBtn.innerHTML = allExpanded ? '&#9650; Collapse all' : '&#9660; Expand all';
  });

  resetBtn.addEventListener('click', function () {
    resultsSection.classList.add('hidden');
    emptyState.classList.add('hidden');
    processingOverlay.classList.add('hidden');
    mobPaginationBar.classList.add('hidden');
    uploadZone.classList.remove('hidden');
    mobList.innerHTML = '';
    fileInput.value = '';
    allEntries = [];
    latestDate = null;
    activeFilter = 'all';
    allExpanded = false;
    mobPage = 0;
    currentMobs.clear();
    openMobs.clear();
    selectedMobs.clear();
    expandAllBtn.innerHTML = '&#9660; Expand all';
    setActivePill('all');
    customRange.classList.add('hidden');
  });

  selectAllBtn.addEventListener('click', function () {
    currentMobs.forEach(function (_, name) { selectedMobs.add(name); });
    document.querySelectorAll('.mob-checkbox').forEach(function (cb) {
      cb.checked = true;
      cb.closest('.mob-entry').classList.add('selected');
    });
  });

  deselectAllBtn.addEventListener('click', function () {
    selectedMobs.clear();
    document.querySelectorAll('.mob-checkbox').forEach(function (cb) {
      cb.checked = false;
      cb.closest('.mob-entry').classList.remove('selected');
    });
  });

  // ── Mob list pagination ────────────────────────────────────────────────────
  mobPagePrev.addEventListener('click', function () {
    if (mobPage > 0) { mobPage--; renderMobPage(); }
  });
  mobPageNext.addEventListener('click', function () {
    if (mobPage < Math.ceil(currentMobs.size / mobPageSize) - 1) { mobPage++; renderMobPage(); }
  });
  document.querySelectorAll('.mob-page-size-pill').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.mob-page-size-pill').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      mobPageSize = parseInt(btn.dataset.size, 10);
      mobPage = 0;
      renderMobPage();
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

  // Expose checked loot data across all pages for loot-actions.js
  window.getCheckedLoot = function () {
    var results = [];
    currentMobs.forEach(function (data, mobName) {
      if (!selectedMobs.has(mobName)) return;
      data.entries.forEach(function (entry) {
        // Find whether this row's item checkbox is checked in the DOM (current page)
        // For off-page mobs assume all item rows checked (default state)
        results.push({ mob: mobName, item: entry.item, qty: entry.qty, looter: entry.looter });
      });
    });
    return results;
  };

  const SESSION_GAP_MS = 15 * 60 * 1000; // 15 minutes

  function groupByMob(entries) {
    // 1. Bucket all entries by mob name (unsorted)
    const rawGroups = new Map();
    entries.forEach(function (entry) {
      if (!rawGroups.has(entry.mob)) rawGroups.set(entry.mob, []);
      rawGroups.get(entry.mob).push(entry);
    });

    // 2. For each mob, sort by date then split into sessions on gaps > 15 min
    const sessions = [];
    rawGroups.forEach(function (mobEntries, mobName) {
      mobEntries.sort(function (a, b) { return a.date - b.date; });

      const mobSessions = [];
      let current = [mobEntries[0]];
      for (let i = 1; i < mobEntries.length; i++) {
        if (mobEntries[i].date - mobEntries[i - 1].date > SESSION_GAP_MS) {
          mobSessions.push(current);
          current = [mobEntries[i]];
        } else {
          current.push(mobEntries[i]);
        }
      }
      mobSessions.push(current);

      mobSessions.forEach(function (sessionEntries, idx) {
        sessions.push({
          mobName:       mobName,
          sessionEntries: sessionEntries,
          latestDate:    sessionEntries[sessionEntries.length - 1].date,
          firstDate:     sessionEntries[0].date,
          multiSession:  mobSessions.length > 1,
        });
      });
    });

    // 3. Sort all sessions newest-first
    sessions.sort(function (a, b) { return b.latestDate - a.latestDate; });

    // 4. Build result Map — add a time label when the same mob appears more than once
    const result = new Map();
    sessions.forEach(function (session) {
      let displayName = session.mobName;
      if (session.multiSession) {
        displayName += ' · ' + formatSessionLabel(session.firstDate);
      }

      // Aggregate rows within this session (item + looter key)
      const rows = new Map();
      session.sessionEntries.forEach(function (entry) {
        const key = entry.item + '\x00' + entry.looter;
        if (rows.has(key)) {
          rows.get(key).qty += entry.qty;
        } else {
          rows.set(key, { looter: entry.looter, qty: entry.qty, item: entry.item, timestamp: entry.timestamp });
        }
      });

      // Use a unique map key in case display names collide
      let mapKey = displayName;
      let n = 2;
      while (result.has(mapKey)) { mapKey = displayName + ' (' + (n++) + ')'; }
      result.set(mapKey, { entries: [...rows.values()] });
    });

    return result;
  }

  function formatSessionLabel(date) {
    // "May 31 21:35"
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return months[date.getMonth()] + ' ' + date.getDate() +
           ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
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
      mobPaginationBar.classList.add('hidden');
      if (totalBeforeTargetFilter > 0) {
        emptyState.innerHTML =
          '&#128269; No loot from raid targets found in this time window.<br>' +
          '<span style="font-size:0.85em">' + totalBeforeTargetFilter + ' non-raid loot ' +
          (totalBeforeTargetFilter === 1 ? 'entry was' : 'entries were') +
          ' filtered out. Check <b>Edit Raid Targets</b> if a mob is missing from the list.</span>';
      } else if (allEntries.length > 0) {
        emptyState.innerHTML = '&#128269; No loot entries match the selected time window.';
      } else {
        emptyState.innerHTML = '&#128196; No loot entries found in this log file.';
      }
      emptyState.classList.remove('hidden');
      resultsSummary.textContent = '0 mobs · 0 loot entries';
      resultsSection.classList.remove('hidden');
      return;
    }

    // Store full map and reset pagination state
    currentMobs = mobs;
    mobPage = 0;
    openMobs.clear();
    selectedMobs.clear();

    let totalItems = 0;
    mobs.forEach(function (data) { totalItems += data.entries.length; });
    resultsSummary.textContent =
      mobs.size + ' mob' + (mobs.size !== 1 ? 's' : '') +
      ' · ' + totalItems + ' loot ' + (totalItems !== 1 ? 'entries' : 'entry');

    resultsSection.classList.remove('hidden');
    renderMobPage();
  }

  function renderMobPage() {
    mobList.innerHTML = '';
    const entries   = [...currentMobs.entries()];
    const total     = entries.length;
    const totalPages = Math.max(1, Math.ceil(total / mobPageSize));
    if (mobPage >= totalPages) mobPage = totalPages - 1;

    const start = mobPage * mobPageSize;
    const end   = Math.min(start + mobPageSize, total);

    entries.slice(start, end).forEach(function (pair) {
      mobList.appendChild(buildMobEntry(pair[0], pair[1].entries));
    });

    // Pagination bar: only show when there's more than one page
    const multiPage = total > mobPageSize;
    mobPaginationBar.classList.toggle('hidden', !multiPage);
    mobPageInfo.textContent = 'Page ' + (mobPage + 1) + ' of ' + totalPages;
    mobPagePrev.disabled = mobPage === 0;
    mobPageNext.disabled = mobPage >= totalPages - 1;
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
    cb.checked = selectedMobs.has(mobName);
    if (cb.checked) li.classList.add('selected');
    cb.addEventListener('change', function (e) {
      e.stopPropagation();
      li.classList.toggle('selected', cb.checked);
      if (cb.checked) selectedMobs.add(mobName);
      else            selectedMobs.delete(mobName);
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

    if (openMobs.has(mobName)) li.classList.add('open');
    header.addEventListener('click', function (e) {
      if (e.target === cb) return;
      li.classList.toggle('open');
      if (li.classList.contains('open')) openMobs.add(mobName);
      else openMobs.delete(mobName);
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

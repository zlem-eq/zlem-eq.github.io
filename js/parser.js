(function () {
  const uploadZone          = document.getElementById('upload-zone');
  const processingOverlay   = document.getElementById('processing-overlay');
  const fileInput           = document.getElementById('file-input');
  const splitFileInput      = document.getElementById('split-file-input');
  const resultsSection      = document.getElementById('results-section');
  const emptyState          = document.getElementById('empty-state');
  const mobList             = document.getElementById('mob-list');
  const resultsSummary      = document.getElementById('results-summary');
  const expandAllBtn        = document.getElementById('expand-all-btn');
  const selectAllBtn        = document.getElementById('select-all-btn');
  const deselectAllBtn      = document.getElementById('deselect-all-btn');
  const extractLogsBtn      = document.getElementById('extract-logs-btn');
  const resetBtn            = document.getElementById('reset-btn');
  const addSplitBtn         = document.getElementById('add-split-btn');
  const mobPaginationBar    = document.getElementById('mob-pagination-bar');
  const mobPagePrev         = document.getElementById('mob-page-prev');
  const mobPageNext         = document.getElementById('mob-page-next');
  const mobPageInfo         = document.getElementById('mob-page-info');

  let allExpanded = false;
  const customRange   = document.getElementById('custom-range');
  const rangeFrom     = document.getElementById('range-from');
  const rangeTo       = document.getElementById('range-to');

  // All parsed splits — each split is one uploaded file
  // [{entries: [{looter, qty, item, mob, timestamp, date, rawLine}], label: string, playerName: string}]
  let allSplits  = [];
  let latestDate = null;
  let activeFilter = 'all';

  const splitSections         = document.getElementById('split-sections');
  const primarySectionHeader  = document.getElementById('primary-section-header');
  const raidLootFilter        = document.getElementById('raid-loot-filter');

  // Mob list state — keys are "splitIdx|displayName"
  let currentMobs  = new Map(); // "splitIdx|displayName" → {entries, rawEntries, displayName, splitIdx}
  let primaryMobs  = new Map(); // subset of currentMobs where splitIdx === 0
  let mobPage      = 0;
  let mobPageSize  = 10;
  let openMobs      = new Set(); // "splitIdx|displayName"
  let selectedMobs  = new Set(); // "splitIdx|displayName"
  let excludedItems = new Set(); // normalised item names excluded by user
  let uncheckedLoot = new Map(); // mobKey → Set<"item\x00looter"> of unchecked rows

  // ── Drag-and-drop ──────────────────────────────────────────────────────────
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0 && !uploadZone.classList.contains('hidden')) {
      processFiles(files);
    }
  });

  uploadZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });
  uploadZone.addEventListener('dragleave', function () {
    uploadZone.classList.remove('drag-over');
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files.length > 0) processFiles(fileInput.files);
  });

  splitFileInput.addEventListener('change', function () {
    if (splitFileInput.files[0]) addSplitFile(splitFileInput.files[0]);
    splitFileInput.value = '';
  });

  addSplitBtn.addEventListener('click', function () {
    splitFileInput.click();
  });

  expandAllBtn.addEventListener('click', function () {
    allExpanded = !allExpanded;
    if (allExpanded) {
      currentMobs.forEach(function (_, key) { openMobs.add(key); });
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
    splitSections.innerHTML = '';
    splitSections.classList.add('hidden');
    primarySectionHeader.classList.add('hidden');
    primarySectionHeader.textContent = '';
    fileInput.value = '';
    allSplits = [];
    latestDate = null;
    activeFilter = 'all';
    allExpanded = false;
    mobPage = 0;
    currentMobs.clear();
    primaryMobs.clear();
    openMobs.clear();
    selectedMobs.clear();
    excludedItems.clear();
    uncheckedLoot.clear();
    expandAllBtn.innerHTML = '&#9660; Expand all';
    setActivePill('all');
    customRange.classList.add('hidden');
    raidLootFilter.checked = true;
  });

  extractLogsBtn.addEventListener('click', function () {
    // For mobs visible in the DOM, read which item rows are currently checked.
    // Keys not present in this map are off-page — treat all their items as checked.
    var domCheckedItems = {}; // mobKey → Set<itemName> that are checked
    document.querySelectorAll('.mob-entry[data-mob-key]').forEach(function (li) {
      var key = li.dataset.mobKey;
      var checked = new Set();
      li.querySelectorAll('tbody tr').forEach(function (tr) {
        var cb = tr.querySelector('.loot-checkbox');
        if (cb && cb.checked) {
          var itemCell = tr.cells[1];
          if (itemCell) checked.add(itemCell.textContent);
        }
      });
      domCheckedItems[key] = checked;
    });

    var lines = [];
    currentMobs.forEach(function (data, key) {
      if (!selectedMobs.has(key)) return;
      var itemFilter = domCheckedItems[key]; // undefined → off-page, include all
      data.rawEntries.forEach(function (entry) {
        if (!entry.rawLine) return;
        if (itemFilter && !itemFilter.has(entry.item)) return;
        lines.push({ date: entry.date, line: entry.rawLine });
      });
    });

    if (lines.length === 0) {
      alert('No selected raid targets with loot entries to extract.');
      return;
    }

    lines.sort(function (a, b) { return a.date - b.date; });

    var content = lines.map(function (l) { return l.line; }).join('\r\n');
    var blob = new Blob([content], { type: 'text/plain' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = (allSplits[0] && allSplits[0].label) || 'extracted_log.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  selectAllBtn.addEventListener('click', function () {
    currentMobs.forEach(function (_, key) { selectedMobs.add(key); });
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
    if (mobPage < Math.ceil(primaryMobs.size / mobPageSize) - 1) { mobPage++; renderMobPage(); }
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
  raidLootFilter.addEventListener('change', applyFilter);

  function setActivePill(filter) {
    document.querySelectorAll('.filter-pill').forEach(function (p) {
      p.classList.toggle('active', p.dataset.filter === filter);
    });
  }

  // ── File processing ────────────────────────────────────────────────────────
  let activeWorkers = [];
  const processingLabel = processingOverlay.querySelector('.processing-label');

  function extractPlayerName(filename) {
    const m = filename.match(/^eqlog_(.+?)_[^_]+\.txt$/i);
    return m ? m[1] : 'You';
  }

  function processFiles(fileList) {
    const files = Array.from(fileList);
    const playerName = extractPlayerName(files[0].name);

    uploadZone.classList.add('hidden');
    resultsSection.classList.add('hidden');
    emptyState.classList.add('hidden');
    processingLabel.textContent = files.length > 1
      ? 'Parsing ' + files.length + ' log files…'
      : 'Parsing log file…';
    processingOverlay.classList.remove('hidden');

    allSplits = [];
    openMobs.clear();
    selectedMobs.clear();
    excludedItems.clear();
    uncheckedLoot.clear();

    // Terminate any previously running workers
    activeWorkers.forEach(function (w) { w.terminate(); });
    activeWorkers = [];

    var results = new Array(files.length); // preserve file order
    var remaining = files.length;

    files.forEach(function (file, idx) {
      const worker = new Worker('../js/parse-worker.js');
      activeWorkers.push(worker);
      const pn = extractPlayerName(file.name);

      worker.onmessage = function (e) {
        if (e.data.type === 'progress') return; // skip per-file progress for multi-file
        results[idx] = e.data.entries.map(function (entry) {
          entry.date = new Date(entry.date); return entry;
        });
        remaining--;
        if (remaining === 0) {
          // Merge all results, sort chronologically
          var merged = [].concat.apply([], results);
          merged.sort(function (a, b) { return a.date - b.date; });
          var label = files.length === 1 ? files[0].name : files.length + ' files';
          allSplits = [{ entries: merged, label: label, playerName: playerName }];
          recomputeLatestDate();
          activeFilter = 'all';
          allExpanded  = false;
          expandAllBtn.innerHTML = '&#9660; Expand all';
          setActivePill('all');
          customRange.classList.add('hidden');
          processingOverlay.classList.add('hidden');
          applyFilter();
        }
      };

      worker.onerror = function (err) {
        processingOverlay.classList.add('hidden');
        uploadZone.classList.remove('hidden');
        console.error('Parse worker error:', err);
      };

      const reader = new FileReader();
      reader.onload = function (ev) {
        worker.postMessage(
          { buffer: ev.target.result, playerName: pn },
          [ev.target.result]
        );
      };
      reader.readAsArrayBuffer(file);
    });
  }

  // ── Add split log file ─────────────────────────────────────────────────────
  function addSplitFile(file) {
    const playerName = extractPlayerName(file.name);
    processingLabel.textContent = 'Parsing split log…';
    resultsSection.classList.add('hidden');
    processingOverlay.classList.remove('hidden');

    const splitWorker = new Worker('../js/parse-worker.js');

    splitWorker.onmessage = function (e) {
      if (e.data.type === 'progress') {
        processingLabel.textContent = 'Parsing split log… ' + e.data.pct + '%';
        return;
      }
      const entries = e.data.entries.map(function (entry) {
        entry.date = new Date(entry.date); return entry;
      });
      allSplits.push({ entries: entries, label: file.name, playerName: playerName });
      recomputeLatestDate();
      processingOverlay.classList.add('hidden');
      applyFilter();
    };

    splitWorker.onerror = function (err) {
      processingOverlay.classList.add('hidden');
      resultsSection.classList.remove('hidden');
      console.error('Split-log worker error:', err);
    };

    const reader = new FileReader();
    reader.onload = function (ev) {
      splitWorker.postMessage(
        { buffer: ev.target.result, playerName: playerName },
        [ev.target.result]
      );
    };
    reader.readAsArrayBuffer(file);
  }

  function recomputeLatestDate() {
    latestDate = null;
    allSplits.forEach(function (split) {
      split.entries.forEach(function (entry) {
        if (!latestDate || entry.date > latestDate) latestDate = entry.date;
      });
    });
  }

  // ── Filtering & grouping ───────────────────────────────────────────────────
  function applyFilter() {
    var targetSet = window.RaidTargets ? window.RaidTargets.getSet() : null;

    // ── Primary (allSplits[0]): apply time + excluded + target filters ──────
    var primaryFiltered = allSplits.length > 0 ? allSplits[0].entries : [];
    if (activeFilter !== 'all' && latestDate) {
      var fromDate, toDate;
      if (activeFilter === 'custom') {
        fromDate = rangeFrom.value ? new Date(rangeFrom.value) : null;
        toDate   = rangeTo.value   ? new Date(rangeTo.value)   : null;
      } else {
        var hours = activeFilter === '1h' ? 1 : activeFilter === '8h' ? 8 : 24;
        toDate   = latestDate;
        fromDate = new Date(latestDate.getTime() - hours * 60 * 60 * 1000);
      }
      primaryFiltered = primaryFiltered.filter(function (e) {
        if (fromDate && e.date < fromDate) return false;
        if (toDate   && e.date > toDate)   return false;
        return true;
      });
    }
    if (excludedItems.size > 0) {
      primaryFiltered = primaryFiltered.filter(function (e) {
        return !excludedItems.has(e.item.toLowerCase());
      });
    }
    var raidLootOnly = raidLootFilter.checked;
    if (raidLootOnly && window.RaidLootItems) {
      primaryFiltered = primaryFiltered.filter(function (e) {
        return window.RaidLootItems.has(e.item.toLowerCase());
      });
    }
    var totalBeforeTargetFilter = primaryFiltered.length;
    if (targetSet) {
      primaryFiltered = primaryFiltered.filter(function (e) {
        return targetSet[e.mob.toLowerCase()];
      });
    }
    var primaryGrouped = groupByMob(primaryFiltered);

    // ── Additional splits (allSplits[1+]): excluded + raid-loot + target only ─
    var splitGroups = allSplits.slice(1).map(function (split, i) {
      var filtered = split.entries;
      if (excludedItems.size > 0) {
        filtered = filtered.filter(function (e) {
          return !excludedItems.has(e.item.toLowerCase());
        });
      }
      if (raidLootOnly && window.RaidLootItems) {
        filtered = filtered.filter(function (e) {
          return window.RaidLootItems.has(e.item.toLowerCase());
        });
      }
      if (targetSet) {
        filtered = filtered.filter(function (e) {
          return targetSet[e.mob.toLowerCase()];
        });
      }
      return { label: split.label, mobs: groupByMob(filtered), playerName: split.playerName, splitIdx: i + 1 };
    });

    // Rebuild currentMobs (primary + splits) for select-all / extract / getCheckedLoot
    currentMobs = new Map();
    primaryGrouped.forEach(function (data, displayName) {
      currentMobs.set('0|' + displayName, { entries: data.entries, rawEntries: data.rawEntries, displayName: displayName, splitIdx: 0 });
    });
    splitGroups.forEach(function (group) {
      group.mobs.forEach(function (data, displayName) {
        var key = group.splitIdx + '|' + displayName;
        currentMobs.set(key, { entries: data.entries, rawEntries: data.rawEntries, displayName: displayName, splitIdx: group.splitIdx });
      });
    });

    primaryMobs = new Map([...currentMobs].filter(function (p) { return p[1].splitIdx === 0; }));

    renderSplitSections(splitGroups);
    renderResults(primaryGrouped, totalBeforeTargetFilter);
  }

  window.reapplyFilter = applyFilter;

  window.excludeItem = function (itemName) {
    excludedItems.add(itemName.toLowerCase());
    applyFilter();
  };

  window.getCheckedLoot = function () {
    var results = [];
    currentMobs.forEach(function (data, key) {
      if (!selectedMobs.has(key)) return;
      data.entries.forEach(function (entry) {
        results.push({ mob: data.displayName, item: entry.item, qty: entry.qty, looter: entry.looter });
      });
    });
    return results;
  };

  const SESSION_GAP_MS = 15 * 60 * 1000;

  function groupByMob(entries) {
    const rawGroups = new Map();
    entries.forEach(function (entry) {
      if (!rawGroups.has(entry.mob)) rawGroups.set(entry.mob, []);
      rawGroups.get(entry.mob).push(entry);
    });

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

      mobSessions.forEach(function (sessionEntries) {
        sessions.push({
          mobName:        mobName,
          sessionEntries: sessionEntries,
          latestDate:     sessionEntries[sessionEntries.length - 1].date,
          firstDate:      sessionEntries[0].date,
          multiSession:   mobSessions.length > 1,
        });
      });
    });

    sessions.sort(function (a, b) { return b.latestDate - a.latestDate; });

    const result = new Map();
    sessions.forEach(function (session) {
      let displayName = session.mobName;
      if (session.multiSession) {
        displayName += ' · ' + formatSessionLabel(session.firstDate);
      }

      const rows = new Map();
      session.sessionEntries.forEach(function (entry) {
        const key = entry.item + '\x00' + entry.looter;
        if (rows.has(key)) {
          rows.get(key).qty += entry.qty;
        } else {
          rows.set(key, { looter: entry.looter, qty: entry.qty, item: entry.item, timestamp: entry.timestamp });
        }
      });

      let mapKey = displayName;
      let n = 2;
      while (result.has(mapKey)) { mapKey = displayName + ' (' + (n++) + ')'; }
      result.set(mapKey, { entries: [...rows.values()], rawEntries: session.sessionEntries });
    });

    return result;
  }

  function formatSessionLabel(date) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return months[date.getMonth()] + ' ' + date.getDate() +
           ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function formatTimestamp(raw) {
    const parts = raw.split(' ');
    return parts[1] + ' ' + parts[2] + ' ' + parts[3];
  }

  function toDatetimeLocal(d) {
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) +
           'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  function renderSplitSections(splitGroups) {
    splitSections.innerHTML = '';
    if (splitGroups.length === 0) {
      splitSections.classList.add('hidden');
      return;
    }
    splitSections.classList.remove('hidden');
    splitGroups.forEach(function (group) {
      var section = document.createElement('div');
      section.className = 'split-section';

      var hdr = document.createElement('div');
      hdr.className = 'split-section-header';
      hdr.textContent = group.label;
      section.appendChild(hdr);

      var ul = document.createElement('ul');
      ul.className = 'mob-list';
      group.mobs.forEach(function (data, displayName) {
        var key = group.splitIdx + '|' + displayName;
        ul.appendChild(buildMobEntry(key, displayName, data.entries, group.playerName));
      });
      section.appendChild(ul);
      splitSections.appendChild(section);
    });
  }

  function renderResults(primaryGrouped, totalBeforeTargetFilter) {
    uploadZone.classList.add('hidden');
    mobList.innerHTML = '';
    emptyState.classList.add('hidden');
    allExpanded = false;
    expandAllBtn.innerHTML = '&#9660; Expand all';

    var hasSplits = allSplits.length > 1;

    if (primaryGrouped.size === 0 && !hasSplits) {
      mobPaginationBar.classList.add('hidden');
      var primaryEntryCount = allSplits.length > 0 ? allSplits[0].entries.length : 0;
      if (totalBeforeTargetFilter > 0) {
        emptyState.innerHTML =
          '&#128269; No loot from raid targets found in this time window.<br>' +
          '<span style="font-size:0.85em">' + totalBeforeTargetFilter + ' non-raid loot ' +
          (totalBeforeTargetFilter === 1 ? 'entry was' : 'entries were') +
          ' filtered out. Check <b>Edit Raid Targets</b> if a mob is missing from the list.</span>';
      } else if (primaryEntryCount > 0) {
        emptyState.innerHTML = '&#128269; No loot entries match the selected time window.';
      } else {
        emptyState.innerHTML = '&#128196; No loot entries found in this log file.';
      }
      emptyState.classList.remove('hidden');
      resultsSummary.textContent = '0 mobs · 0 loot entries';
      resultsSection.classList.remove('hidden');
      return;
    }

    mobPage = 0;

    primarySectionHeader.textContent = allSplits[0] ? allSplits[0].label : '';
    primarySectionHeader.classList.remove('hidden');

    var totalItems = 0;
    currentMobs.forEach(function (data) { totalItems += data.entries.length; });
    var mobCount = currentMobs.size;
    var splitCount = allSplits.length - 1;
    resultsSummary.textContent =
      mobCount + ' mob' + (mobCount !== 1 ? 's' : '') +
      ' · ' + totalItems + ' loot ' + (totalItems !== 1 ? 'entries' : 'entry') +
      (splitCount > 0 ? ' · ' + splitCount + ' split' + (splitCount !== 1 ? 's' : '') : '');

    resultsSection.classList.remove('hidden');
    renderMobPage();
  }

  function renderMobPage() {
    mobList.innerHTML = '';
    const entries    = [...primaryMobs.entries()];
    const total      = entries.length;
    const totalPages = Math.max(1, Math.ceil(total / mobPageSize));
    if (mobPage >= totalPages) mobPage = totalPages - 1;

    const start = mobPage * mobPageSize;
    const end   = Math.min(start + mobPageSize, total);

    entries.slice(start, end).forEach(function (pair) {
      var key  = pair[0];
      var data = pair[1];
      var playerName = allSplits[0] ? allSplits[0].playerName : 'You';
      mobList.appendChild(buildMobEntry(key, data.displayName, data.entries, playerName));
    });

    const multiPage = total > mobPageSize;
    mobPaginationBar.classList.toggle('hidden', !multiPage);
    mobPageInfo.textContent = 'Page ' + (mobPage + 1) + ' of ' + totalPages;
    mobPagePrev.disabled = mobPage === 0;
    mobPageNext.disabled = mobPage >= totalPages - 1;
  }

  function buildMobEntry(key, mobName, entries, playerName) {
    const li = document.createElement('li');
    li.className = 'mob-entry';
    li.dataset.mobKey = key;

    const header = document.createElement('div');
    header.className = 'mob-header';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'mob-checkbox';
    cb.setAttribute('aria-label', 'Select ' + mobName);
    cb.checked = selectedMobs.has(key);
    if (cb.checked) li.classList.add('selected');
    cb.addEventListener('change', function (e) {
      e.stopPropagation();
      li.classList.toggle('selected', cb.checked);
      if (cb.checked) selectedMobs.add(key);
      else            selectedMobs.delete(key);
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

    if (openMobs.has(key)) li.classList.add('open');
    header.addEventListener('click', function (e) {
      if (e.target === cb) return;
      li.classList.toggle('open');
      if (li.classList.contains('open')) openMobs.add(key);
      else openMobs.delete(key);
    });

    const panel = document.createElement('div');
    panel.className = 'loot-panel';

    const table = document.createElement('table');
    table.className = 'loot-table';

    const thead = document.createElement('thead');
    const theadRow = document.createElement('tr');

    const thCheck = document.createElement('th');
    thCheck.className = 'col-check';
    const selectAllCb = document.createElement('input');
    selectAllCb.type = 'checkbox';
    selectAllCb.className = 'loot-select-all';
    selectAllCb.title = 'Select / deselect all items';
    // selectAllCb state is set after tbody is built below
    thCheck.appendChild(selectAllCb);

    theadRow.appendChild(thCheck);
    ['Item', 'Qty', 'Looted by', 'Time', ''].forEach(function (label, i) {
      var th = document.createElement('th');
      if (i === 4) th.className = 'col-exclude';
      th.textContent = label;
      theadRow.appendChild(th);
    });
    thead.appendChild(theadRow);

    const tbody = document.createElement('tbody');

    // Helper: sync header checkbox to current row states
    function syncHeaderCb() {
      var all          = tbody.querySelectorAll('.loot-checkbox');
      var checkedCount = tbody.querySelectorAll('.loot-checkbox:checked').length;
      selectAllCb.checked      = checkedCount === all.length;
      selectAllCb.indeterminate = checkedCount > 0 && checkedCount < all.length;
    }

    selectAllCb.addEventListener('click', function (e) {
      e.stopPropagation();
      // Update all row checkboxes
      tbody.querySelectorAll('.loot-checkbox').forEach(function (cb) {
        cb.checked = selectAllCb.checked;
      });
      // Persist: clear or populate uncheckedLoot for this mob
      if (selectAllCb.checked) {
        uncheckedLoot.delete(key);
      } else {
        var set = new Set();
        entries.forEach(function (entry) { set.add(entry.item + '\x00' + entry.looter); });
        uncheckedLoot.set(key, set);
      }
    });

    entries.forEach(function (entry) {
      const tr = document.createElement('tr');
      const itemKey = entry.item + '\x00' + entry.looter;

      const tdCheck = document.createElement('td');
      tdCheck.className = 'col-check';
      const rowCb = document.createElement('input');
      rowCb.type = 'checkbox';
      rowCb.className = 'loot-checkbox';
      // Restore persisted state: unchecked if explicitly unchecked before
      rowCb.checked = !(uncheckedLoot.has(key) && uncheckedLoot.get(key).has(itemKey));
      rowCb.addEventListener('click', function (e) {
        e.stopPropagation();
        // Persist row state
        if (!rowCb.checked) {
          if (!uncheckedLoot.has(key)) uncheckedLoot.set(key, new Set());
          uncheckedLoot.get(key).add(itemKey);
        } else {
          if (uncheckedLoot.has(key)) uncheckedLoot.get(key).delete(itemKey);
        }
        syncHeaderCb();
      });
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

      const tdExclude = document.createElement('td');
      tdExclude.className = 'col-exclude';
      const excludeBtn = document.createElement('button');
      excludeBtn.className = 'exclude-item-btn';
      excludeBtn.title = 'Exclude all "' + entry.item + '" from loot lists';
      excludeBtn.textContent = '✕';
      excludeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        window.excludeItem(entry.item);
      });
      tdExclude.appendChild(excludeBtn);

      tr.appendChild(tdCheck);
      tr.appendChild(tdItem);
      tr.appendChild(tdQty);
      tr.appendChild(tdLooter);
      tr.appendChild(tdTime);
      tr.appendChild(tdExclude);
      tbody.appendChild(tr);
    });

    syncHeaderCb(); // set header checkbox state based on restored row states

    table.appendChild(thead);
    table.appendChild(tbody);
    panel.appendChild(table);

    li.appendChild(header);
    li.appendChild(panel);
    return li;
  }
})();

(function () {
  const uploadZone          = document.getElementById('upload-zone');
  const processingOverlay   = document.getElementById('processing-overlay');
  const fileInput           = document.getElementById('file-input');
  const fullScanToggle      = document.getElementById('full-scan-toggle');
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
  const hideSpellsFilter      = document.getElementById('hide-spells-filter');

  // Mob list state — keys are "splitIdx|displayName"
  let currentMobs  = new Map(); // "splitIdx|displayName" → {entries, rawEntries, displayName, splitIdx}
  let primaryMobs  = new Map(); // subset of currentMobs where splitIdx === 0
  let mobPage      = 0;
  let mobPageSize  = 10;
  let openMobs      = new Set(); // "splitIdx|displayName"
  let selectedMobs  = new Set(); // "splitIdx|displayName"
  let excludedItems = new Set(); // normalised item names excluded by user
  let uncheckedLoot = new Map(); // mobKey → Set<"item\x00looter"> of unchecked rows

  // ── File selection ───────────────────────────────────────────────────────────
  // Prefer the File System Access API when available: its handles let the worker
  // re-open the file if EverQuest appends to it mid-read (see parse-worker.js).
  const SUPPORTS_FS_ACCESS = typeof window.showOpenFilePicker === 'function';

  // Wrap a plain File (no handle) as the { file, handle } shape the worker expects.
  function itemsFromFiles(fileList) {
    return Array.from(fileList).map(function (f) { return { file: f, handle: null }; });
  }

  async function pickFilesViaApi(multiple) {
    const handles = await window.showOpenFilePicker({
      multiple: !!multiple,
      types: [{ description: 'EverQuest log', accept: { 'text/plain': ['.txt'] } }]
    });
    return Promise.all(handles.map(async function (h) {
      return { file: await h.getFile(), handle: h };
    }));
  }

  // Extract { file, handle } items from a drop, capturing FileSystemFileHandles when
  // the browser supports them. getAsFileSystemHandle()/getAsFile() must be called
  // synchronously while the DataTransfer is still alive, so gather them up front.
  async function itemsFromDataTransfer(dt) {
    const canHandle = SUPPORTS_FS_ACCESS && dt.items && dt.items.length &&
      typeof dt.items[0].getAsFileSystemHandle === 'function';
    if (!canHandle) return itemsFromFiles(dt.files);

    const pending = [];
    for (let i = 0; i < dt.items.length; i++) {
      const it = dt.items[i];
      if (it.kind === 'file') pending.push({ handleP: it.getAsFileSystemHandle(), file: it.getAsFile() });
    }
    const items = [];
    for (let k = 0; k < pending.length; k++) {
      let handle = null;
      try { handle = await pending[k].handleP; } catch (e) { handle = null; }
      if (handle && handle.kind === 'file') items.push({ file: await handle.getFile(), handle: handle });
      else if (pending[k].file) items.push({ file: pending[k].file, handle: null });
    }
    return items;
  }

  // ── Drag-and-drop ──────────────────────────────────────────────────────────
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    if (uploadZone.classList.contains('hidden')) return;
    itemsFromDataTransfer(e.dataTransfer).then(function (items) {
      if (items.length > 0) processItems(items);
    });
  });

  uploadZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });
  uploadZone.addEventListener('dragleave', function () {
    uploadZone.classList.remove('drag-over');
  });

  // When the File System Access API is available, intercept the click on the hidden
  // <input> overlay and use the picker instead so we obtain a refreshable handle.
  fileInput.addEventListener('click', function (e) {
    if (!SUPPORTS_FS_ACCESS) return;
    e.preventDefault();
    pickFilesViaApi(true).then(function (items) {
      if (items && items.length) processItems(items);
    }).catch(function (err) {
      if (err && err.name !== 'AbortError') console.error('File picker error:', err);
    });
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files.length > 0) processItems(itemsFromFiles(fileInput.files));
  });

  splitFileInput.addEventListener('change', function () {
    if (splitFileInput.files[0]) addSplitFile(splitFileInput.files[0], null);
    splitFileInput.value = '';
  });

  addSplitBtn.addEventListener('click', function () {
    if (SUPPORTS_FS_ACCESS) {
      pickFilesViaApi(false).then(function (items) {
        if (items && items[0]) addSplitFile(items[0].file, items[0].handle);
      }).catch(function (err) {
        if (err && err.name !== 'AbortError') console.error('File picker error:', err);
      });
    } else {
      splitFileInput.click();
    }
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
    hideSpellsFilter.checked = true;
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
  hideSpellsFilter.addEventListener('change', applyFilter);

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

  function processItems(items) {
    const files = items.map(function (it) { return it.file; });
    const playerName = extractPlayerName(files[0].name);
    const tailDays = fullScanToggle.checked ? null : 7;

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

    items.forEach(function (item, idx) {
      const file = item.file;
      const worker = new Worker('../js/parse-worker.js');
      activeWorkers.push(worker);
      const pn = extractPlayerName(file.name);

      worker.onmessage = function (e) {
        if (e.data.type === 'progress') {
          if (files.length === 1) {
            processingLabel.textContent = 'Parsing log file… ' + e.data.pct + '%';
          }
          return;
        }
        if (e.data.type === 'error') { handleParseError(e.data); return; }
        results[idx] = e.data.entries.map(function (entry) {
          entry.date = new Date(entry.date); return entry;
        });
        remaining--;
        if (files.length > 1) {
          processingLabel.textContent = 'Parsing ' + files.length + ' log files… ' + (files.length - remaining) + ' / ' + files.length + ' complete';
        }
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
        handleParseError({ name: 'Error', message: (err && err.message) || 'Worker error' });
        console.error('Parse worker error:', err);
      };

      worker.postMessage({ file: file, handle: item.handle, playerName: pn, tailDays: tailDays });
    });
  }

  // Abort the in-progress load and tell the user what to do. NotReadableError almost
  // always means EverQuest changed the log mid-read.
  function handleParseError(info) {
    activeWorkers.forEach(function (w) { w.terminate(); });
    activeWorkers = [];
    processingOverlay.classList.add('hidden');
    uploadZone.classList.remove('hidden');
    if (info && info.name === 'NotReadableError') {
      alert('Could not read the log file because it changed while loading — EverQuest is still writing to it.\n\n' +
            'Please try selecting the file again' +
            (SUPPORTS_FS_ACCESS ? '.' : ', or type /log off in-game (or close EverQuest) first.'));
    } else {
      alert('Failed to parse the log file: ' + ((info && info.message) || 'unknown error'));
    }
  }

  // ── Add split log file ─────────────────────────────────────────────────────
  function addSplitFile(file, handle) {
    const playerName = extractPlayerName(file.name);
    processingLabel.textContent = 'Parsing split log…';
    resultsSection.classList.add('hidden');
    processingOverlay.classList.remove('hidden');

    const splitWorker = new Worker('../js/parse-worker.js');

    function failSplit(info) {
      processingOverlay.classList.add('hidden');
      resultsSection.classList.remove('hidden');
      if (info && info.name === 'NotReadableError') {
        alert('Could not read the split log because it changed while loading — EverQuest is still writing to it. Please try again.');
      }
    }

    splitWorker.onmessage = function (e) {
      if (e.data.type === 'progress') {
        processingLabel.textContent = 'Parsing split log… ' + e.data.pct + '%';
        return;
      }
      if (e.data.type === 'error') { failSplit(e.data); console.error('Split parse failed:', e.data.message); return; }
      const entries = e.data.entries.map(function (entry) {
        entry.date = new Date(entry.date); return entry;
      });
      allSplits.push({ entries: entries, label: file.name, playerName: playerName });
      recomputeLatestDate();
      processingOverlay.classList.add('hidden');
      applyFilter();
    };

    splitWorker.onerror = function (err) {
      failSplit({ name: 'Error', message: (err && err.message) || 'Worker error' });
      console.error('Split-log worker error:', err);
    };

    // Split logs are read in full (they're small extracted snippets, not live logs).
    splitWorker.postMessage({ file: file, handle: handle || null, playerName: playerName, tailDays: null });
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
        toDate   = new Date();
        fromDate = new Date(toDate.getTime() - hours * 60 * 60 * 1000);
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
    if (hideSpellsFilter.checked) {
      primaryFiltered = primaryFiltered.filter(function (e) {
        return !e.item.startsWith('Spell: ') && !e.item.startsWith('Song: ') &&
               !e.item.startsWith('Tome of ') && !e.item.startsWith('Ancient: ');
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
    primaryGrouped.forEach(function (data, mapKey) {
      currentMobs.set('0|' + mapKey, { entries: data.entries, rawEntries: data.rawEntries, displayName: data.displayName, sessionLabel: data.sessionLabel, firstDate: data.firstDate, splitIdx: 0 });
    });
    splitGroups.forEach(function (group) {
      group.mobs.forEach(function (data, mapKey) {
        var key = group.splitIdx + '|' + mapKey;
        currentMobs.set(key, { entries: data.entries, rawEntries: data.rawEntries, displayName: data.displayName, sessionLabel: data.sessionLabel, firstDate: data.firstDate, splitIdx: group.splitIdx });
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
    // Deduplicate by (mob, session, item, looter) so that the same physical loot
    // event — visible in every player's log — is counted exactly once, while items
    // looted by players who have no split file are still captured from whichever
    // split happens to record them first.
    var seen = new Set();
    var results = [];
    currentMobs.forEach(function (data, key) {
      if (!selectedMobs.has(key)) return;
      data.entries.forEach(function (entry) {
        var dedupKey = data.displayName + '\x01' + (data.sessionLabel || '') + '\x01' + entry.item + '\x01' + entry.looter;
        if (seen.has(dedupKey)) return;
        seen.add(dedupKey);
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
      const displayName = session.mobName;
      const sessionLabel = formatSessionLabel(session.firstDate);

      const rows = new Map();
      session.sessionEntries.forEach(function (entry) {
        const key = entry.item + '\x00' + entry.looter;
        if (rows.has(key)) {
          rows.get(key).qty += entry.qty;
        } else {
          rows.set(key, { looter: entry.looter, qty: entry.qty, item: entry.item, timestamp: entry.timestamp });
        }
      });

      let mapKey = displayName + (sessionLabel ? ' · ' + sessionLabel : '');
      let n = 2;
      while (result.has(mapKey)) { mapKey = displayName + (sessionLabel ? ' · ' + sessionLabel : '') + ' (' + (n++) + ')'; }
      result.set(mapKey, { entries: [...rows.values()], rawEntries: session.sessionEntries, displayName: displayName, sessionLabel: sessionLabel, firstDate: session.firstDate });
    });

    return result;
  }

  function formatSessionLabel(date) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return months[date.getMonth()] + ' ' + date.getDate() +
           ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function formatDateLabel(date) {
    const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return days[date.getDay()] + ', ' + months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
  }

  function dateDayKey(date) {
    return date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate();
  }

  function buildDateDivider(label) {
    const li = document.createElement('li');
    li.className = 'date-divider';
    li.setAttribute('aria-hidden', 'true');
    const span = document.createElement('span');
    span.className = 'date-divider-label';
    span.textContent = label;
    li.appendChild(span);
    return li;
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
      var currentDayKey = null;
      group.mobs.forEach(function (data, mapKey) {
        var key = group.splitIdx + '|' + mapKey;
        var dayKey = data.firstDate ? dateDayKey(data.firstDate) : null;
        if (dayKey && dayKey !== currentDayKey) {
          currentDayKey = dayKey;
          ul.appendChild(buildDateDivider(formatDateLabel(data.firstDate)));
        }
        ul.appendChild(buildMobEntry(key, data.displayName, data.sessionLabel, data.entries, group.playerName));
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

    var currentDayKey = null;
    entries.slice(start, end).forEach(function (pair) {
      var key  = pair[0];
      var data = pair[1];
      var playerName = allSplits[0] ? allSplits[0].playerName : 'You';
      var dayKey = data.firstDate ? dateDayKey(data.firstDate) : null;
      if (dayKey && dayKey !== currentDayKey) {
        currentDayKey = dayKey;
        mobList.appendChild(buildDateDivider(formatDateLabel(data.firstDate)));
      }
      mobList.appendChild(buildMobEntry(key, data.displayName, data.sessionLabel, data.entries, playerName));
    });

    const multiPage = total > mobPageSize;
    mobPaginationBar.classList.toggle('hidden', !multiPage);
    mobPageInfo.textContent = 'Page ' + (mobPage + 1) + ' of ' + totalPages;
    mobPagePrev.disabled = mobPage === 0;
    mobPageNext.disabled = mobPage >= totalPages - 1;
  }

  function buildMobEntry(key, mobName, sessionLabel, entries, playerName) {
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

    const sessionEl = document.createElement('span');
    sessionEl.className = 'mob-session-label';
    sessionEl.textContent = sessionLabel || '';

    const countEl = document.createElement('span');
    countEl.className = 'mob-count';
    countEl.textContent = entries.length + ' item' + (entries.length !== 1 ? 's' : '');

    const chevron = document.createElement('span');
    chevron.className = 'mob-chevron';
    chevron.textContent = '▶';

    // Wrap the checkbox in a label so the whole zone is a large click target,
    // visually separated from the name by a divider.
    const checkZone = document.createElement('label');
    checkZone.className = 'mob-check-zone';
    checkZone.appendChild(cb);

    header.appendChild(checkZone);
    header.appendChild(nameEl);
    header.appendChild(sessionEl);
    header.appendChild(countEl);
    header.appendChild(chevron);

    if (openMobs.has(key)) li.classList.add('open');
    header.addEventListener('click', function (e) {
      // Clicks inside the checkbox zone toggle selection, not expand/collapse.
      if (e.target.closest('.mob-check-zone')) return;
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
      // Wrap in a label so the whole checkbox cell is a click target.
      const checkZone = document.createElement('label');
      checkZone.className = 'loot-check-zone';
      checkZone.appendChild(rowCb);
      tdCheck.appendChild(checkZone);

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
      excludeBtn.setAttribute('data-tooltip', 'Remove ALL occurrences of this item name from ALL raid targets! *To see them again refresh or reload the log file.');
      excludeBtn.textContent = 'Remove';
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

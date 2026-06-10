(function () {
  // ── DOM refs ───────────────────────────────────────────────────────────────
  var uploadZone        = document.getElementById('upload-zone');
  var processingOverlay = document.getElementById('processing-overlay');
  var processingLabel   = processingOverlay.querySelector('.processing-label');
  var fileInput         = document.getElementById('file-input');
  var resultsSection    = document.getElementById('results-section');
  var emptyState        = document.getElementById('empty-state');
  var resultsSummary    = document.getElementById('results-summary');
  var tbody             = document.getElementById('delivery-tbody');
  var pageInfo          = document.getElementById('page-info');
  var pagePrev          = document.getElementById('page-prev');
  var pageNext          = document.getElementById('page-next');
  var selectAllBtn      = document.getElementById('select-all-btn');
  var deselectAllBtn    = document.getElementById('deselect-all-btn');
  var resetBtn          = document.getElementById('reset-btn');
  var genBtn            = document.getElementById('gen-delivery-list-btn');
  var deliveryOutput    = document.getElementById('delivery-output');
  var deliveryOutputText= document.getElementById('delivery-output-text');
  var copyBtn           = document.getElementById('copy-delivery-list-btn');
  var customRange       = document.getElementById('custom-range');
  var rangeFrom         = document.getElementById('range-from');
  var rangeTo           = document.getElementById('range-to');
  var raidLootFilter    = document.getElementById('raid-loot-filter');

  // ── State ──────────────────────────────────────────────────────────────────
  var allEntries      = [];
  var filteredEntries = [];
  var latestDate      = null;
  var activeFilter    = 'all';
  var currentPage     = 0;
  var pageSize        = 20;
  var checkedSet      = new Set(); // indices into filteredEntries
  var parseWorker     = null;

  // ── Drag & drop (prevent page navigation on miss) ─────────────────────────
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    var file = e.dataTransfer.files[0];
    if (file && !uploadZone.classList.contains('hidden')) processFile(file);
  });
  uploadZone.addEventListener('dragover', function (e) {
    e.preventDefault(); uploadZone.classList.add('drag-over');
  });
  uploadZone.addEventListener('dragleave', function () {
    uploadZone.classList.remove('drag-over');
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files[0]) processFile(fileInput.files[0]);
  });

  // ── Reset ──────────────────────────────────────────────────────────────────
  resetBtn.addEventListener('click', function () {
    resultsSection.classList.add('hidden');
    emptyState.classList.add('hidden');
    processingOverlay.classList.add('hidden');
    deliveryOutput.classList.add('hidden');
    uploadZone.classList.remove('hidden');
    fileInput.value = '';
    allEntries = []; filteredEntries = []; latestDate = null;
    activeFilter = 'all'; currentPage = 0;
    checkedSet.clear();
    setActivePill('all');
    customRange.classList.add('hidden');
    raidLootFilter.checked = false;
  });

  // ── Select / deselect all ──────────────────────────────────────────────────
  selectAllBtn.addEventListener('click', function () {
    filteredEntries.forEach(function (_, i) { checkedSet.add(i); });
    renderPage();
  });
  deselectAllBtn.addEventListener('click', function () {
    checkedSet.clear();
    renderPage();
  });

  // ── Time filter pills ──────────────────────────────────────────────────────
  document.querySelectorAll('.filter-pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      activeFilter = pill.dataset.filter;
      setActivePill(activeFilter);
      if (activeFilter === 'custom') {
        customRange.classList.remove('hidden');
        if (!rangeFrom.value && latestDate) {
          rangeFrom.value = toDatetimeLocal(new Date(latestDate.getTime() - 8 * 3600000));
          rangeTo.value   = toDatetimeLocal(latestDate);
        }
      } else {
        customRange.classList.add('hidden');
      }
      applyFilter();
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

  // ── Pagination ─────────────────────────────────────────────────────────────
  pagePrev.addEventListener('click', function () {
    if (currentPage > 0) { currentPage--; renderPage(); }
  });
  pageNext.addEventListener('click', function () {
    var totalPages = Math.ceil(filteredEntries.length / pageSize);
    if (currentPage < totalPages - 1) { currentPage++; renderPage(); }
  });

  document.querySelectorAll('.page-size-pill').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.page-size-pill').forEach(function (b) {
        b.classList.remove('active');
      });
      btn.classList.add('active');
      pageSize = parseInt(btn.dataset.size, 10);
      currentPage = 0;
      renderPage();
    });
  });

  // ── Generate ───────────────────────────────────────────────────────────────
  genBtn.addEventListener('click', function () {
    var checked = filteredEntries.filter(function (_, i) { return checkedSet.has(i); });
    if (checked.length === 0) {
      deliveryOutputText.textContent = '(No items selected.)';
      deliveryOutput.classList.remove('hidden');
      return;
    }
    var lines = [];
    lines.push('📦✅ **Delivery Confirmations**');
    lines.push('');
    checked.forEach(function (e, i) {
      if (e.entryType === 'offered') {
        if (i > 0 && checked[i - 1].entryType !== 'offered') lines.push('');
        lines.push(discordCode(e.rawLine));
        lines.push(discordCode(e.completeRawLine));
        if (i < checked.length - 1) lines.push('');
      } else {
        lines.push(discordCode(e.rawLine || e.rawMessage));
      }
    });
    deliveryOutputText.textContent = lines.join('\n');
    deliveryOutput.classList.remove('hidden');
    deliveryOutput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  copyBtn.addEventListener('click', function () {
    navigator.clipboard.writeText(deliveryOutputText.textContent).then(function () {
      var orig = copyBtn.textContent;
      copyBtn.textContent = '✓ Copied!';
      setTimeout(function () { copyBtn.textContent = orig; }, 1800);
    });
  });

  // ── File processing ────────────────────────────────────────────────────────
  function processFile(file) {
    uploadZone.classList.add('hidden');
    resultsSection.classList.add('hidden');
    emptyState.classList.add('hidden');
    deliveryOutput.classList.add('hidden');
    processingLabel.textContent = 'Parsing log file…';
    processingOverlay.classList.remove('hidden');

    if (parseWorker) parseWorker.terminate();
    parseWorker = new Worker('../js/delivery-parse-worker.js');

    parseWorker.onmessage = function (e) {
      if (e.data.type === 'progress') {
        processingLabel.textContent = 'Parsing log file… ' + e.data.pct + '%';
        return;
      }
      allEntries = e.data.entries.map(function (entry) {
        entry.date = new Date(entry.date); return entry;
      });
      latestDate = allEntries.length
        ? allEntries.reduce(function (max, e) { return e.date > max ? e.date : max; }, allEntries[0].date)
        : null;
      activeFilter = 'all';
      setActivePill('all');
      customRange.classList.add('hidden');
      processingOverlay.classList.add('hidden');
      applyFilter();
    };

    parseWorker.onerror = function () {
      processingOverlay.classList.add('hidden');
      uploadZone.classList.remove('hidden');
    };

    var reader = new FileReader();
    reader.onload = function (e) {
      parseWorker.postMessage({ buffer: e.target.result }, [e.target.result]);
    };
    reader.readAsArrayBuffer(file);
  }

  // ── Filter ─────────────────────────────────────────────────────────────────
  function applyFilter() {
    var filtered = allEntries;

    if (activeFilter !== 'all' && latestDate) {
      var fromDate, toDate;
      if (activeFilter === 'custom') {
        fromDate = rangeFrom.value ? new Date(rangeFrom.value) : null;
        toDate   = rangeTo.value   ? new Date(rangeTo.value)   : null;
      } else {
        var hours = activeFilter === '1h' ? 1 : activeFilter === '8h' ? 8 : 24;
        toDate   = latestDate;
        fromDate = new Date(latestDate.getTime() - hours * 3600000);
      }
      filtered = allEntries.filter(function (e) {
        if (fromDate && e.date < fromDate) return false;
        if (toDate   && e.date > toDate)   return false;
        return true;
      });
    }

    // Raid loot only filter (only applies to entries that carry an item name)
    if (raidLootFilter.checked && window.RaidLootItems) {
      filtered = filtered.filter(function (e) {
        if (!e.item) return true; // trade_complete entries have no item — always include
        return window.RaidLootItems.has(e.item.replace(/^(?:a|an|the) /i, '').toLowerCase());
      });
    }

    // Sort newest first
    filtered = filtered.slice().sort(function (a, b) { return b.date - a.date; });

    filteredEntries = filtered;
    // Default all entries to unchecked
    checkedSet.clear();
    currentPage = 0;
    deliveryOutput.classList.add('hidden');
    renderResults();
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function renderResults() {
    uploadZone.classList.add('hidden');
    emptyState.classList.add('hidden');

    if (filteredEntries.length === 0) {
      if (allEntries.length > 0) {
        emptyState.innerHTML = '&#128269; No deliveries match the selected time window.';
      } else {
        emptyState.innerHTML = '&#128230; No delivery confirmations found in this log file.';
      }
      emptyState.classList.remove('hidden');
      resultsSummary.textContent = '0 deliveries';
      resultsSection.classList.remove('hidden');
      tbody.innerHTML = '';
      pageInfo.textContent = '';
      return;
    }

    var total = filteredEntries.length;
    var checked = checkedSet.size;
    resultsSummary.textContent = total + ' deliver' + (total !== 1 ? 'ies' : 'y') +
      ' · ' + checked + ' selected';

    resultsSection.classList.remove('hidden');
    renderPage();
  }

  function renderPage() {
    var total      = filteredEntries.length;
    var totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (currentPage >= totalPages) currentPage = totalPages - 1;

    var start = currentPage * pageSize;
    var end   = Math.min(start + pageSize, total);
    var page  = filteredEntries.slice(start, end);

    tbody.innerHTML = '';
    var lastDayKey = null;
    page.forEach(function (entry, localIdx) {
      var globalIdx = start + localIdx;
      var dayKey = entry.date.getFullYear() + '-' + entry.date.getMonth() + '-' + entry.date.getDate();
      if (dayKey !== lastDayKey) {
        lastDayKey = dayKey;
        var dividerTr = document.createElement('tr');
        dividerTr.className = 'date-divider-row';
        var dividerTd = document.createElement('td');
        dividerTd.colSpan = 5;
        dividerTd.style.padding = '0 1rem';
        var dividerDiv = document.createElement('div');
        dividerDiv.className = 'date-divider';
        dividerDiv.setAttribute('aria-hidden', 'true');
        var dividerSpan = document.createElement('span');
        dividerSpan.className = 'date-divider-label';
        dividerSpan.textContent = formatDateLabel(entry.date);
        dividerDiv.appendChild(dividerSpan);
        dividerTd.appendChild(dividerDiv);
        dividerTr.appendChild(dividerTd);
        tbody.appendChild(dividerTr);
      }
      var tr = document.createElement('tr');

      var tdCb = document.createElement('td');
      tdCb.className = 'col-check';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'loot-checkbox';
      cb.checked = checkedSet.has(globalIdx);
      cb.addEventListener('change', function () {
        if (cb.checked) checkedSet.add(globalIdx);
        else            checkedSet.delete(globalIdx);
        updateSummary();
      });
      tdCb.appendChild(cb);

      var tdType = document.createElement('td');
      tdType.className = 'col-type';
      tdType.textContent = entry.entryType === 'delivery' ? 'Parcel' : 'Trade';

      var tdItem = document.createElement('td');
      var tdTo   = document.createElement('td');
      tdItem.textContent = entry.item;
      tdTo.textContent   = entry.recipient;

      var tdTime = document.createElement('td');
      tdTime.className = 'loot-timestamp';
      tdTime.textContent = formatTimestamp(entry.timestamp);

      tr.appendChild(tdCb);
      tr.appendChild(tdItem);
      tr.appendChild(tdTo);
      tr.appendChild(tdType);
      tr.appendChild(tdTime);
      tbody.appendChild(tr);
    });

    pageInfo.textContent = 'Page ' + (currentPage + 1) + ' of ' + totalPages;
    pagePrev.disabled = currentPage === 0;
    pageNext.disabled = currentPage >= totalPages - 1;
  }

  function updateSummary() {
    var total   = filteredEntries.length;
    var checked = checkedSet.size;
    resultsSummary.textContent = total + ' deliver' + (total !== 1 ? 'ies' : 'y') +
      ' · ' + checked + ' selected';
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function formatDateLabel(date) {
    var days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return days[date.getDay()] + ', ' + months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
  }

  function formatTimestamp(raw) {
    var p = raw.split(' ');
    return p[1] + ' ' + p[2] + ' ' + p[3];
  }

  function toDatetimeLocal(d) {
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
           'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function discordCode(text) {
    if (text.indexOf('`') !== -1) return '`` ' + text + ' ``';
    return '`' + text + '`';
  }

  function discordEscape(text) {
    return text.replace(/([*_~`\\|])/g, '\\$1');
  }
})();

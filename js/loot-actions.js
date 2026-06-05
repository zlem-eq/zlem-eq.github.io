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

  // Render one copy-able pre block per {label, text} entry into container.
  function renderBlocks(container, blocks) {
    container.innerHTML = '';
    blocks.forEach(function (block) {
      if (!block.text) return;

      var wrap = document.createElement('div');
      wrap.className = 'chunk-block';

      var lbl = document.createElement('div');
      lbl.className = 'chunk-label';
      lbl.textContent = block.label;
      wrap.appendChild(lbl);

      var hdr = document.createElement('div');
      hdr.className = 'output-box-header';

      var charCount = document.createElement('span');
      charCount.className = 'output-box-label';
      charCount.textContent = block.text.length + ' chars';

      var copyBtn = document.createElement('button');
      copyBtn.className = 'btn-copy';
      copyBtn.textContent = '📋 Copy';
      (function (btn, txt) {
        btn.addEventListener('click', function () { copyText(txt, btn); });
      })(copyBtn, block.text);

      hdr.appendChild(charCount);
      hdr.appendChild(copyBtn);

      var pre = document.createElement('pre');
      pre.className = 'output-text delivery-output-pre';
      pre.textContent = block.text;

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
  var genOpenDkpBtn       = document.getElementById('gen-opendkp-btn');
  var openDkpModal        = document.getElementById('opendkp-modal');
  var openDkpModalClose   = document.getElementById('opendkp-modal-close');
  var openDkpModalClose2  = document.getElementById('opendkp-modal-close2');
  var openDkpText         = document.getElementById('opendkp-text');
  var openDkpTextLabel    = document.getElementById('opendkp-text-label');
  var copyOpenDkpBtn      = document.getElementById('copy-opendkp-btn');
  var auctionsToggle       = document.getElementById('opendkp-auctions-toggle');
  var auctionsBody         = document.getElementById('opendkp-auctions-body');
  var openDkpRaidSelect    = document.getElementById('opendkp-raid-select');
  var openDkpRaidRefresh   = document.getElementById('opendkp-raid-refresh');
  var openDkpDuration        = document.getElementById('opendkp-duration');
  var openDkpUsername        = document.getElementById('opendkp-username');
  var auctionItemsList       = document.getElementById('auction-items-list');
  var auctionItemsSelectAll  = document.getElementById('auction-items-select-all');
  var auctionSelectNextBtn   = document.getElementById('auction-select-next-btn');
  var openDkpPassword      = document.getElementById('opendkp-password');
  var createAuctionsBtn    = document.getElementById('create-auctions-btn');
  var createAuctionsStatus = document.getElementById('create-auctions-status');

  var openDkpWebClientId   = null;
  var openDkpClientInput   = document.getElementById('opendkp-client-input');

  function buildAuctionItemsList(lootString) {
    var counts = {};
    var order  = [];
    (lootString || '').split('|').forEach(function (name) {
      name = name.trim();
      if (!name || name.charAt(0) === '(') return;
      if (!counts[name]) { counts[name] = 0; order.push(name); }
      counts[name]++;
    });

    auctionItemsList.innerHTML = '';
    order.forEach(function (name) {
      var li = document.createElement('li');

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'auction-item-cb';
      cb.checked = false;
      cb.addEventListener('change', syncSelectAll);

      var nameSpan = document.createElement('span');
      nameSpan.className = 'auction-item-name';
      nameSpan.textContent = name;

      var countSpan = document.createElement('span');
      countSpan.className = 'auction-item-count';
      countSpan.textContent = '×' + counts[name];

      li.appendChild(cb);
      li.appendChild(nameSpan);
      li.appendChild(countSpan);
      auctionItemsList.appendChild(li);
    });

    auctionItemsSelectAll.checked = false;
    auctionItemsSelectAll.indeterminate = false;
  }

  function syncSelectAll() {
    var all  = auctionItemsList.querySelectorAll('.auction-item-cb');
    var checked = auctionItemsList.querySelectorAll('.auction-item-cb:checked');
    auctionItemsSelectAll.checked       = checked.length === all.length;
    auctionItemsSelectAll.indeterminate = checked.length > 0 && checked.length < all.length;
  }

  auctionSelectNextBtn.addEventListener('click', function () {
    // Deselect all first, then check the next 10 available (not disabled, not already auctioned)
    var available = Array.from(auctionItemsList.querySelectorAll('li')).filter(function (li) {
      var cb = li.querySelector('.auction-item-cb');
      return cb && !cb.disabled;
    });
    available.forEach(function (li) {
      li.querySelector('.auction-item-cb').checked = false;
    });
    available.slice(0, 10).forEach(function (li) {
      li.querySelector('.auction-item-cb').checked = true;
    });
    syncSelectAll();
  });

  auctionItemsSelectAll.addEventListener('change', function () {
    auctionItemsList.querySelectorAll('.auction-item-cb').forEach(function (cb) {
      cb.checked = auctionItemsSelectAll.checked;
    });
    auctionItemsSelectAll.indeterminate = false;
  });

  genOpenDkpBtn.addEventListener('click', function () {
    var items = getCheckedItems();
    if (items.length === 0) {
      openDkpText.textContent = '(No checked items found — select at least one mob and item.)';
      openDkpTextLabel.textContent = '';
    } else {
      var parts = [];
      items.forEach(function (i) {
        for (var j = 0; j < i.qty; j++) parts.push(i.item);
      });
      var str = parts.join('|');
      openDkpText.textContent = str;
      openDkpTextLabel.textContent = parts.length + ' item' + (parts.length !== 1 ? 's' : '');
    }
    buildAuctionItemsList(openDkpText.textContent);
    openModal(openDkpModal);
  });

  openDkpModalClose.addEventListener('click',  function () { closeModal(openDkpModal); });
  openDkpModalClose2.addEventListener('click', function () { closeModal(openDkpModal); });
  openDkpModal.addEventListener('click', function (e) { if (e.target === openDkpModal) closeModal(openDkpModal); });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !openDkpModal.classList.contains('hidden')) closeModal(openDkpModal);
  });

  copyOpenDkpBtn.addEventListener('click', function () {
    copyText(openDkpText.textContent, copyOpenDkpBtn);
  });

  // ── Create OpenDKP Auctions collapsible panel ──────────────────────────────
  var openDkpRaidsLoaded = false;

  auctionsToggle.addEventListener('click', function () {
    var expanded = auctionsToggle.getAttribute('aria-expanded') === 'true';
    auctionsToggle.setAttribute('aria-expanded', String(!expanded));
    auctionsBody.classList.toggle('hidden', expanded);
    if (!expanded) {
      if (!openDkpRaidsLoaded) fetchOpenDkpRaids();
      if (!openDkpWebClientId) fetchWebClientId();
    }
  });

  function fetchWebClientId() {
    return fetch('https://api.opendkp.com/clients/' + getOpenDkpClient())
      .then(function (res) { return res.json(); })
      .then(function (data) {
        openDkpWebClientId = data.WebClientId || null;
        return openDkpWebClientId;
      });
  }

  function ensureWebClientId() {
    if (openDkpWebClientId) return Promise.resolve(openDkpWebClientId);
    return fetchWebClientId().then(function (id) {
      if (!id) throw new Error('Could not load client config from OpenDKP.');
      return id;
    });
  }

  function fetchOpenDkpRaids(force) {
    if (openDkpRaidsLoaded && !force) return;
    openDkpRaidSelect.innerHTML = '<option value="">Loading raids…</option>';
    openDkpRaidRefresh.disabled = true;
    openDkpRaidRefresh.textContent = '…';
    fetch('https://api.opendkp.com/clients/' + getOpenDkpClient() + '/raids?count=20')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        openDkpRaidsLoaded = true;
        var raids = Array.isArray(data) ? data : (data.raids || []);
        openDkpRaidSelect.innerHTML = '<option value="">— Select a raid (optional) —</option>';
        raids.forEach(function (raid) {
          var opt = document.createElement('option');
          opt.value = raid.RaidId || raid.Id || '';
          var name = raid.Name || raid.RaidName || ('Raid ' + opt.value);
          var dateStr = '';
          if (raid.Timestamp) {
            var d = new Date(raid.Timestamp);
            dateStr = ' — ' + (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
          }
          opt.textContent = name + dateStr;
          openDkpRaidSelect.appendChild(opt);
        });
        openDkpRaidRefresh.disabled = false;
        openDkpRaidRefresh.textContent = '↻';
      })
      .catch(function () {
        openDkpRaidsLoaded = false;
        openDkpRaidSelect.innerHTML = '<option value="">— Unable to load raids —</option>';
        openDkpRaidRefresh.disabled = false;
        openDkpRaidRefresh.textContent = '↻';
      });
  }

  openDkpRaidRefresh.addEventListener('click', function () {
    openDkpRaidsLoaded = false;
    fetchOpenDkpRaids(true);
  });

  // ── Create Auctions button ─────────────────────────────────────────────────
  function setAuctionStatus(msg, type) {
    createAuctionsStatus.textContent = msg;
    createAuctionsStatus.className = 'create-auctions-status' + (type ? ' status-' + type : '');
  }

  createAuctionsBtn.addEventListener('click', function () {
    var lootString = openDkpText.textContent.trim();
    var raidId     = openDkpRaidSelect.value;
    var username   = openDkpUsername.value.trim();
    var password   = openDkpPassword.value;

    if (!lootString || lootString.charAt(0) === '(') {
      return setAuctionStatus('No loot string to create auctions from.', 'error');
    }
    if (!raidId) {
      return setAuctionStatus('Please select a raid first.', 'error');
    }
    if (!username || !password) {
      return setAuctionStatus('Please enter your username and password.', 'error');
    }

    // Build item counts from checked list items only
    var checkedNames = new Set();
    auctionItemsList.querySelectorAll('li').forEach(function (li) {
      var cb = li.querySelector('.auction-item-cb');
      if (cb && cb.checked && !cb.disabled) {
        checkedNames.add(li.querySelector('.auction-item-name').textContent);
      }
    });

    var itemCounts = {};
    lootString.split('|').forEach(function (name) {
      name = name.trim();
      if (!name || !checkedNames.has(name)) return;
      itemCounts[name] = (itemCounts[name] || 0) + 1;
    });
    var uniqueNames = Object.keys(itemCounts);

    setAuctionStatus('Loading client config…', '');
    createAuctionsBtn.disabled = true;

    // Step 1 — Ensure WebClientId is loaded
    ensureWebClientId()
      .then(function (webClientId) {
        // Step 2 — Get auth token from Cognito
        setAuctionStatus('Signing in…', '');
        return fetch('https://cognito-idp.us-east-2.amazonaws.com/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth'
          },
          body: JSON.stringify({
            AuthFlow: 'USER_PASSWORD_AUTH',
            ClientId: webClientId,
            AuthParameters: { USERNAME: username, PASSWORD: password }
          })
        });
      })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (e) { throw new Error(e.message || 'Login failed (' + res.status + ')'); });
        return res.json();
      })
      .then(function (authData) {
        var idToken = authData.AuthenticationResult && authData.AuthenticationResult.IdToken;
        if (!idToken) throw new Error('Login succeeded but no ID token returned.');

        setAuctionStatus('Searching items…', '');

        // Step 3 — Item Search POST
        return fetch('https://api.opendkp.com/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(uniqueNames)
        })
          .then(function (res) {
            if (!res.ok) throw new Error('Item search failed (' + res.status + ')');
            return res.json();
          })
          .then(function (itemResults) {
            var itemMap = {};
            itemResults.forEach(function (item) {
              itemMap[(item.ItemName || '').toLowerCase()] = item;
            });

            var auctions = [];
            uniqueNames.forEach(function (name) {
              var found = itemMap[name.toLowerCase()];
              if (!found) return;
              var id = found.ItemID || found.ItemId || 0;
              auctions.push({
                BidType:        'Open',
                MinimumBid:     5,
                MaximumBid:     0,
                Duration:       parseInt(openDkpDuration.value, 10) || 2,
                ItemQuantity:   itemCounts[name],
                ItemId:         id,
                AllowDeletes:   true,
                Item: {
                  ItemId:     id,
                  Name:       found.ItemName,
                  GameItemId: found.GameItemId || id,
                  IdGame:     0
                },
                RaidId: parseInt(raidId, 10)
              });
            });

            if (auctions.length === 0) {
              throw new Error('No items could be matched — check the loot string.');
            }

            setAuctionStatus('Creating ' + auctions.length + ' auction' + (auctions.length !== 1 ? 's' : '') + '…', '');

            // Step 4 — Create Auction PUT
            var submittedNames = auctions.map(function (a) { return a.Item.Name; });
            var auctionsBody = JSON.stringify(auctions);
            return fetch('https://api.opendkp.com/clients/' + getOpenDkpClient() + '/auctions', {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': String(new TextEncoder().encode(auctionsBody).length),
                'Authorization': 'Bearer ' + idToken
              },
              body: auctionsBody
            }).then(function (res) { return { res: res, submittedNames: submittedNames }; });
          });
      })
      .then(function (payload) {
        var res = payload.res, submittedNames = payload.submittedNames;
        if (!res.ok) return res.text().then(function (t) { throw new Error('Create auctions failed (' + res.status + '): ' + t); });
        return res.json().then(function (result) { return { result: result, submittedNames: submittedNames }; });
      })
      .then(function (payload) {
        var count = Array.isArray(payload.result) ? payload.result.length : '?';
        setAuctionStatus('✓ ' + count + ' auction' + (count !== 1 ? 's' : '') + ' created successfully.', 'success');
        createAuctionsBtn.disabled = false;

        // Mark submitted items in the list
        var submittedSet = new Set(payload.submittedNames.map(function (n) { return n.toLowerCase(); }));
        auctionItemsList.querySelectorAll('li').forEach(function (li) {
          var nameEl = li.querySelector('.auction-item-name');
          if (!nameEl || !submittedSet.has(nameEl.textContent.toLowerCase())) return;
          var cb = li.querySelector('.auction-item-cb');
          if (cb) { cb.disabled = true; cb.checked = true; }
          if (!li.querySelector('.auction-created-badge')) {
            var badge = document.createElement('span');
            badge.className = 'auction-created-badge';
            badge.textContent = '✓ Auction created';
            li.appendChild(badge);
          }
          li.classList.add('auction-item-done');
        });
      })
      .catch(function (err) {
        setAuctionStatus(err.message || 'An error occurred.', 'error');
        createAuctionsBtn.disabled = false;
      });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 2. GENERATE LOOT DELIVERY LIST
  // ════════════════════════════════════════════════════════════════════════════
  var genDeliveryBtn        = document.getElementById('gen-delivery-btn');
  var deliveryModal         = document.getElementById('delivery-modal');
  var deliveryModalClose    = document.getElementById('delivery-modal-close');
  var deliveryPaste         = document.getElementById('delivery-paste');
  var deliveryGenerateBtn   = document.getElementById('delivery-generate-btn');
  var deliveryRaidSelect    = document.getElementById('delivery-raid-select');
  var deliveryRaidRefresh   = document.getElementById('delivery-raid-refresh');
  var deliveryClientInput   = document.getElementById('delivery-client-input');

  // ── Sync client inputs between both popups ─────────────────────────────────
  function syncClientInputs(source, target) {
    target.value = source.value;
    openDkpWebClientId = null;
    raidsLoaded = false;
    openDkpRaidsLoaded = false;
  }

  deliveryClientInput.addEventListener('input', function () {
    syncClientInputs(deliveryClientInput, openDkpClientInput);
  });

  openDkpClientInput.addEventListener('input', function () {
    syncClientInputs(openDkpClientInput, deliveryClientInput);
    openDkpRaidSelect.innerHTML = '<option value="">— Select a raid (optional) —</option>';
  });

  var deliveryOutputModal    = document.getElementById('delivery-output-modal');
  var deliveryOutputClose    = document.getElementById('delivery-output-close');
  var deliveryOutputClose2   = document.getElementById('delivery-output-close2');
  var deliveryOutputBack     = document.getElementById('delivery-output-back');
  var deliveryChunksContainer = document.getElementById('delivery-chunks-container');
  var deliveryOutputSummary  = document.getElementById('delivery-output-summary');

  // ── OpenDKP config ─────────────────────────────────────────────────────────
  var openDkpClient = 'bt';

  function getOpenDkpClient() {
    var input = document.getElementById('opendkp-client-input');
    return (input && input.value.trim()) || openDkpClient;
  }

  // ── Fetch raids from OpenDKP ───────────────────────────────────────────────
  var raidsLoaded = false;

  function fetchRaids(force) {
    if (raidsLoaded && !force) return;
    deliveryRaidSelect.innerHTML = '<option value="">Loading raids…</option>';
    fetch('https://api.opendkp.com/clients/' + getOpenDkpClient() + '/raids?count=20')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        raidsLoaded = true;
        var raids = Array.isArray(data) ? data : (data.raids || []);
        deliveryRaidRefresh.disabled = false;
        deliveryRaidRefresh.textContent = '↻';
        deliveryRaidSelect.innerHTML = '<option value="">— Select a raid (optional) —</option>';
        raids.forEach(function (raid) {
          var opt = document.createElement('option');
          opt.value = raid.RaidId || raid.Id || '';
          var name = raid.Name || raid.RaidName || ('Raid ' + opt.value);
          var dateStr = '';
          if (raid.Timestamp) {
            var d = new Date(raid.Timestamp);
            dateStr = ' — ' + (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
          }
          opt.textContent = name + dateStr;
          deliveryRaidSelect.appendChild(opt);
        });
      })
      .catch(function () {
        raidsLoaded = false;
        deliveryRaidSelect.innerHTML = '<option value="">— Unable to load raids —</option>';
        deliveryRaidRefresh.disabled = false;
        deliveryRaidRefresh.textContent = '↻';
      });
  }

  deliveryRaidRefresh.addEventListener('click', function () {
    raidsLoaded = false;
    deliveryRaidRefresh.disabled = true;
    deliveryRaidRefresh.textContent = '…';
    fetchRaids(true);
  });

  // ── Fetch auctions and populate loot entries ───────────────────────────────
  function fetchAuctionsForRaid(raidId) {
    deliveryPaste.value = 'Loading auctions…';
    deliveryPaste.disabled = true;

    function fetchPage(page, accumulated) {
      return fetch('https://api.opendkp.com/clients/' + getOpenDkpClient() + '/auctions?page=' + page)
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var results = (data.BidResults || []).filter(function (a) {
            return String(a.RaidId) === String(raidId);
          });
          accumulated = accumulated.concat(results);
          if (data.TotalPages && page < data.TotalPages) {
            return fetchPage(page + 1, accumulated);
          }
          return accumulated;
        });
    }

    fetchPage(1, [])
      .then(function (auctions) {
        var lines = [];
        auctions.forEach(function (auction) {
          var itemName = auction.Item && auction.Item.Name ? auction.Item.Name : 'Unknown Item';
          var qty = auction.ItemQuantity || 1;
          var bids = (auction.Bids || []).slice().sort(function (a, b) { return b.Value - a.Value; });
          var winners = bids.slice(0, qty);
          winners.forEach(function (bid) {
            lines.push(itemName + ';' + bid.Value + ';' + bid.CharacterName + ' gratss');
          });
        });
        deliveryPaste.value = lines.join('\n');
        deliveryPaste.disabled = false;
        if (lines.length === 0) {
          deliveryPaste.value = '';
          deliveryPaste.placeholder = 'No auctions found for this raid.';
        }
      })
      .catch(function () {
        deliveryPaste.value = '';
        deliveryPaste.disabled = false;
        deliveryPaste.placeholder = 'Failed to load auctions.';
      });
  }

  deliveryRaidSelect.addEventListener('change', function () {
    var raidId = deliveryRaidSelect.value;
    if (!raidId) {
      deliveryPaste.value = '';
      return;
    }
    fetchAuctionsForRaid(raidId);
  });

  genDeliveryBtn.addEventListener('click', function () {
    deliveryPaste.value = '';
    fetchRaids();
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
    renderBlocks(deliveryChunksContainer, [
      { label: '✅ Matched Deliveries',   text: output.matchedText   },
      { label: '❌ Unmatched Deliveries', text: output.unmatchedText },
    ]);
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

    // ── Build matched block ───────────────────────────────────────────────────
    var matchedLines = [];
    var timestamp = '*Generated: ' + new Date().toLocaleString() + '*';

    matchedLines.push('📦 **LOOT DELIVERY LIST**');
    matchedLines.push(timestamp);
    matchedLines.push('');

    if (deliverers.length > 0) {
      deliverers.forEach(function (deliverer) {
        var items = byDeliverer[deliverer];
        var label = items.length === 1 ? '1 delivery' : items.length + ' deliveries';
        matchedLines.push('**' + discordEscape(deliverer) + '** — ' + label);
        items.forEach(function (m) {
          var selfDelivery = m.looter === m.entry.winner;
          var arrow = selfDelivery
            ? '→ **' + discordEscape(m.entry.winner) + '** *(already has it)*'
            : '→ **' + discordEscape(m.entry.winner) + '**';
          matchedLines.push('> ' + discordCode(m.entry.itemRaw) + ' ' + arrow);
        });
        matchedLines.push('');
      });
    } else {
      matchedLines.push('*(No matched items)*');
      matchedLines.push('');
    }

    // ── Build unmatched block ─────────────────────────────────────────────────
    var unmatchedLines = [];

    if (noDelivery.length > 0 || unassigned.length > 0) {
      unmatchedLines.push('⚠️ **UNMATCHED DELIVERIES**');
      unmatchedLines.push(timestamp);
      unmatchedLines.push('');
    }

    if (noDelivery.length > 0) {
      unmatchedLines.push('**No Delivery Player Found** (' + noDelivery.length + ')');
      noDelivery.forEach(function (e) {
        unmatchedLines.push('> ' + discordCode(e.itemRaw) + ' → **' + discordEscape(e.winner) + '**');
      });
      unmatchedLines.push('');
    }

    if (unassigned.length > 0) {
      unmatchedLines.push('**Unassigned Raid Items** (' + unassigned.length + ')');
      unassigned.forEach(function (ci) {
        unmatchedLines.push('> ' + discordCode(ci.item) + ' looted by **' + discordEscape(ci.looter) + '** [' + discordEscape(ci.mob) + ']');
      });
      unmatchedLines.push('');
    }

    // Clean up _used flags
    checkedItems.forEach(function (ci) { delete ci._used; });

    var summary = matched.length + ' matched';
    if (noDelivery.length)  summary += ' · ' + noDelivery.length  + ' missing delivery player';
    if (unassigned.length)  summary += ' · ' + unassigned.length  + ' unassigned raid items';

    return {
      matchedText:   matchedLines.join('\n'),
      unmatchedText: unmatchedLines.length > 0 ? unmatchedLines.join('\n') : '',
      summary:       summary,
    };
  }
})();

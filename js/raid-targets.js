// Raid Targets — default list, localStorage persistence, and modal UI
(function () {
  var STORAGE_KEY = 'raidTargets';

  var DEFAULT_TARGETS = [
    "Kelorek`Dar","Gorenaire","Severilous","Venril Sathir","Trakanon",
    "Cazic-Thule","Talendor","Faydedar","Zlandicar","Dain Frostreaver IV",
    "Derakor the Vindicator","King Tormax","Tunare","Lord Yelinak",
    "Velketor the Sorcerer","Wuoshi","Klandicar","Sontalak","The Itraer Vius",
    "Khati Sha the Twisted","Shei Vinitras","Grieg Veneficus",
    "The Insanity Crawler","The Avatar of War","Arch Lich Rhag`Zadune",
    "High Priest of Ssraeshza","Xanamech Nezmirthafen","Rumblecrush",
    "Doomshade","Maestro of Rancor","Aerin`Dar","Grummus",
    "Manaetic Behemoth","Rydda`Dar","Saryrn","Arlyxir","Jiva","Rizlona",
    "The Protector of Dresolik","Xuzl","Tallon Zek","Terris Thule",
    "The Seventh Hammer","Vallon Zek","Lord Inquisitor Seru",
    "Emperor Ssraeshza","Vyzh`dra the Cursed","Xerkizh The Creator",
    "Innoruuk","Bristlebane","Agnarr the Storm Lord","Bertoxxulous",
    "Mithaniel Marr","Rallos Zek","Solusek Ro","Hraashna the Warder",
    "Kerafyrm","Nanzata the Warder","Ventani the Warder","The Progenitor",
    "Kildrukaun the Ancient","Tjudawos the Ancient","Vyskudra the Ancient",
    "Zeixshi-Kar the Ancient","Master of the Guard","The Final Arbiter",
    "Lady Mirenilla","Lady Nevederia","Lord Feshlak","Lord Koi`Doken",
    "Lord Kreizenn","Lord Vyemm","Cekenar","Dozekar the Cursed",
    "Dagarn the Destroyer","Jorlleag","Lendiniara the Keeper","Telkorenar",
    "Ikatiar the Venom","Gozzrem","Eashen of the Sky",
    "Lord Doljonijiarnimorinar","The Statue of Rallos Zek"
  ];

  // ── Public API ─────────────────────────────────────────────────────────────
  // Returns current targets as a Set of lowercase strings for fast lookup
  window.RaidTargets = {
    getList: function () {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        var parsed = JSON.parse(stored);
        // Fall back to defaults if stored list was accidentally saved empty
        return parsed.length > 0 ? parsed : DEFAULT_TARGETS.slice();
      }
      return DEFAULT_TARGETS.slice();
    },
    getSet: function () {
      var list = window.RaidTargets.getList();
      var set = {};
      list.forEach(function (t) { set[t.toLowerCase()] = true; });
      return set;
    },
    save: function (list) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    },
    resetDefaults: function () {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  // ── Modal wiring ───────────────────────────────────────────────────────────
  var modal        = document.getElementById('targets-modal');
  var openBtn      = document.getElementById('edit-targets-btn');
  var closeBtn     = document.getElementById('modal-close');
  var saveBtn      = document.getElementById('modal-save');
  var resetBtn     = document.getElementById('modal-reset-defaults');
  var targetsList  = document.getElementById('targets-list');

  // Working copy while the modal is open
  var workingList = [];

  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  saveBtn.addEventListener('click', commitSave);
  resetBtn.addEventListener('click', function () {
    if (confirm('Reset to the default list? Your changes will be lost.')) {
      workingList = DEFAULT_TARGETS.slice();
      renderList();
    }
  });

  // Close on backdrop click
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });

  // Close on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
  });

  // Add buttons (top / bottom)
  document.querySelectorAll('.btn-add').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var pos = btn.dataset.position;
      if (pos === 'top') {
        workingList.unshift('');
      } else {
        workingList.push('');
      }
      renderList();
      // Focus the newly added input
      var inputs = targetsList.querySelectorAll('.target-input');
      var target = pos === 'top' ? inputs[0] : inputs[inputs.length - 1];
      if (target) target.focus();
    });
  });

  function openModal() {
    workingList = window.RaidTargets.getList().slice();
    renderList();
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function commitSave() {
    // Collect current input values, strip blanks
    workingList = getCurrentInputValues().filter(function (t) { return t.trim() !== ''; });
    window.RaidTargets.save(workingList);
    closeModal();
    // Re-run the parser filter if results are visible
    if (typeof window.reapplyFilter === 'function') window.reapplyFilter();
  }

  function getCurrentInputValues() {
    return Array.from(targetsList.querySelectorAll('.target-input'))
      .map(function (inp) { return inp.value.trim(); });
  }

  function renderList() {
    targetsList.innerHTML = '';
    workingList.forEach(function (name, idx) {
      targetsList.appendChild(buildRow(name, idx));
    });
  }

  function buildRow(name, idx) {
    var li = document.createElement('li');
    li.className = 'target-row';
    li.dataset.idx = idx;

    var grip = document.createElement('span');
    grip.className = 'target-grip';
    grip.textContent = '⋮⋮';
    grip.setAttribute('aria-hidden', 'true');

    var inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'target-input';
    inp.value = name;
    inp.placeholder = 'Target name…';
    inp.addEventListener('input', function () {
      workingList[idx] = inp.value;
    });

    var removeBtn = document.createElement('button');
    removeBtn.className = 'target-btn target-remove';
    removeBtn.title = 'Remove';
    removeBtn.setAttribute('aria-label', 'Remove ' + (name || 'entry'));
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', function () {
      workingList.splice(idx, 1);
      renderList();
    });

    li.appendChild(grip);
    li.appendChild(inp);
    li.appendChild(removeBtn);
    return li;
  }
})();

(function () {
  // Status data lives on a separate branch (status-data), not main, so the
  // homelab's frequent pushes never trigger a GitHub Pages rebuild.
  const STATUS_URL =
    'https://raw.githubusercontent.com/xoorki/chris-duarte-site/status-data/status.json';
  const STALE_AFTER_MS = 15 * 60 * 1000; // 15 minutes
  const POLL_MS = 30 * 1000; // re-poll while the page is open, for a "live" feel
  const HISTORY_KEY = 'homelabHistory';
  const MAX_HISTORY_POINTS = 30;

  const grid = document.getElementById('statusGrid');
  const pillRow = document.getElementById('pillRow');
  const updatedEl = document.getElementById('statusUpdated');
  const staleNotice = document.getElementById('staleNotice');
  const liveDot = document.getElementById('liveDot');

  if (!grid) return;

  let lastSeenUpdatedAt = null;
  let hadFirstLoad = false;

  function timeAgo(dateStr) {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins === 1) return '1 minute ago';
    if (mins < 60) return mins + ' minutes ago';
    const hours = Math.round(mins / 60);
    if (hours === 1) return '1 hour ago';
    if (hours < 48) return hours + ' hours ago';
    const days = Math.round(hours / 24);
    if (days === 1) return '1 day ago';
    if (days < 60) return days + ' days ago';
    return 'a long time ago';
  }

  function statusLabel(status) {
    if (status === 'up') return 'Online';
    if (status === 'down') return 'Offline';
    return 'Unknown';
  }

  function usageLevel(percent) {
    if (percent >= 85) return 'bad';
    if (percent >= 60) return 'mid';
    return 'ok';
  }

  function usageStateLabel(level) {
    if (level === 'bad') return 'High';
    if (level === 'mid') return 'Busy';
    return 'Normal';
  }

  function setTile(tileEl, valueEl, text, level) {
    if (!tileEl || !valueEl) return;
    valueEl.textContent = text;
    tileEl.classList.remove('level-ok', 'level-mid', 'level-bad', 'level-neutral');
    if (level) tileEl.classList.add('level-' + level);
  }

  function setGauge(arcEl, valueEl, stateEl, percent) {
    if (!arcEl || !valueEl) return;
    const r = 58;
    const circumference = 2 * Math.PI * r;
    arcEl.style.strokeDasharray = String(circumference);
    if (typeof percent !== 'number') {
      arcEl.style.strokeDashoffset = String(circumference);
      arcEl.classList.remove('gauge-arc-ok', 'gauge-arc-mid', 'gauge-arc-bad');
      valueEl.textContent = '—';
      if (stateEl) stateEl.textContent = '—';
      return;
    }
    const clamped = Math.max(0, Math.min(100, percent));
    const offset = circumference * (1 - clamped / 100);
    arcEl.style.strokeDashoffset = String(offset);
    const level = usageLevel(clamped);
    arcEl.classList.remove('gauge-arc-ok', 'gauge-arc-mid', 'gauge-arc-bad');
    arcEl.classList.add('gauge-arc-' + level);
    valueEl.textContent = Math.round(clamped) + '%';
    if (stateEl) stateEl.textContent = usageStateLabel(level);
  }

  function readHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function pushHistory(cpu, mem) {
    const hist = readHistory();
    hist.push({ t: Date.now(), cpu: cpu, mem: mem });
    while (hist.length > MAX_HISTORY_POINTS) hist.shift();
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
    } catch (e) {
      /* localStorage unavailable — sparklines just won't persist between polls */
    }
    return hist;
  }

  function renderSparkline(polylineEl, captionEl, values, label) {
    if (!polylineEl) return;
    const points = values.filter((v) => typeof v === 'number');
    if (points.length < 2) {
      polylineEl.setAttribute('points', '');
      if (captionEl) captionEl.textContent = 'Collecting data…';
      return;
    }
    const margin = 4;
    const usableW = 200 - margin * 2;
    const usableH = 40 - margin * 2;
    const coords = points.map((v, i) => {
      const x = margin + (i / (points.length - 1)) * usableW;
      const clamped = Math.max(0, Math.min(100, v));
      const y = margin + (1 - clamped / 100) * usableH;
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    polylineEl.setAttribute('points', coords.join(' '));
    if (captionEl) {
      captionEl.textContent = 'Live — last ' + points.length + ' ' + label + ' polls this session';
    }
  }

  function renderPills(services, stale) {
    if (!pillRow) return;
    pillRow.innerHTML = '';
    services.forEach((svc) => {
      const status = stale ? 'unknown' : svc.status;
      const pill = document.createElement('span');
      pill.className = 'pill';

      const dot = document.createElement('span');
      dot.className = 'pill-dot status-' + status;

      const name = document.createElement('span');
      name.textContent = svc.name;

      pill.appendChild(dot);
      pill.appendChild(name);
      pillRow.appendChild(pill);
    });
  }

  function render(services, stale) {
    grid.innerHTML = '';
    services.forEach((svc) => {
      const status = stale ? 'unknown' : svc.status;
      const card = document.createElement('div');
      card.className = 'status-card';

      const dot = document.createElement('span');
      dot.className = 'status-dot status-' + status;

      const info = document.createElement('div');
      info.className = 'status-info';

      const name = document.createElement('h3');
      name.textContent = svc.name;

      const detail = document.createElement('p');
      let text = statusLabel(status);
      if (status === 'up' && typeof svc.latency_ms === 'number') {
        text += ' · ' + svc.latency_ms + 'ms';
      }
      detail.textContent = text;

      info.appendChild(name);
      info.appendChild(detail);
      card.appendChild(dot);
      card.appendChild(info);
      grid.appendChild(card);
    });
  }

  function setLiveDot(level) {
    if (!liveDot) return;
    liveDot.classList.remove('live-dot-ok', 'live-dot-mid', 'live-dot-bad');
    if (level) liveDot.classList.add('live-dot-' + level);
  }

  function renderUnavailable() {
    if (updatedEl) updatedEl.textContent = 'Status unavailable';
    setLiveDot('bad');
    setTile(document.getElementById('tileStatus'), document.getElementById('tileStatusValue'), 'Offline', 'bad');
    setTile(document.getElementById('tileUptime'), document.getElementById('tileUptimeValue'), '—', null);
    setTile(document.getElementById('tileCpu'), document.getElementById('tileCpuValue'), '—', null);
    setTile(document.getElementById('tileMem'), document.getElementById('tileMemValue'), '—', null);
    setTile(document.getElementById('tileServices'), document.getElementById('tileServicesValue'), '—', null);
    setGauge(document.getElementById('cpuArc'), document.getElementById('cpuValue'), document.getElementById('cpuState'));
    setGauge(document.getElementById('memArc'), document.getElementById('memValue'), document.getElementById('memState'));
    grid.innerHTML = '<p class="status-error">Couldn’t load status right now.</p>';
    if (pillRow) pillRow.innerHTML = '';
  }

  function loadStatus() {
    fetch(STATUS_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error('status fetch failed');
        return res.json();
      })
      .then((data) => {
        hadFirstLoad = true;
        const stale = Date.now() - new Date(data.updated_at).getTime() > STALE_AFTER_MS;
        const host = data.host || {};
        const services = data.services || [];
        const cpu = typeof host.cpu_percent === 'number' ? host.cpu_percent : null;
        const mem = typeof host.mem_percent === 'number' ? host.mem_percent : null;

        if (updatedEl) updatedEl.textContent = 'Last updated ' + timeAgo(data.updated_at);
        if (staleNotice) staleNotice.hidden = !stale;
        setLiveDot(stale ? 'mid' : 'ok');

        setTile(
          document.getElementById('tileStatus'),
          document.getElementById('tileStatusValue'),
          stale ? 'Stale' : 'Live',
          stale ? 'mid' : 'ok'
        );
        setTile(
          document.getElementById('tileUptime'),
          document.getElementById('tileUptimeValue'),
          host.uptime && !stale ? host.uptime : '—',
          host.uptime && !stale ? 'neutral' : null
        );
        setTile(
          document.getElementById('tileCpu'),
          document.getElementById('tileCpuValue'),
          cpu !== null && !stale ? Math.round(cpu) + '%' : '—',
          cpu !== null && !stale ? usageLevel(cpu) : null
        );
        setTile(
          document.getElementById('tileMem'),
          document.getElementById('tileMemValue'),
          mem !== null && !stale ? Math.round(mem) + '%' : '—',
          mem !== null && !stale ? usageLevel(mem) : null
        );

        const upCount = services.filter((s) => s.status === 'up').length;
        const svcLevel = stale || !services.length
          ? null
          : upCount === services.length
            ? 'ok'
            : upCount === 0
              ? 'bad'
              : 'mid';
        setTile(
          document.getElementById('tileServices'),
          document.getElementById('tileServicesValue'),
          services.length && !stale ? upCount + '/' + services.length + ' up' : '—',
          svcLevel
        );

        setGauge(
          document.getElementById('cpuArc'),
          document.getElementById('cpuValue'),
          document.getElementById('cpuState'),
          stale ? null : cpu
        );
        setGauge(
          document.getElementById('memArc'),
          document.getElementById('memValue'),
          document.getElementById('memState'),
          stale ? null : mem
        );

        // Only add a new history point once per actual new report from the
        // homelab, so reloading the page doesn't pad the chart with repeats.
        if (!stale && cpu !== null && mem !== null && data.updated_at !== lastSeenUpdatedAt) {
          lastSeenUpdatedAt = data.updated_at;
          pushHistory(cpu, mem);
        }
        const hist = readHistory();
        renderSparkline(document.getElementById('cpuSpark'), document.getElementById('cpuSparkCaption'), hist.map((h) => h.cpu), 'CPU');
        renderSparkline(document.getElementById('memSpark'), document.getElementById('memSparkCaption'), hist.map((h) => h.mem), 'memory');

        renderPills(services, stale);
        render(services, stale);
      })
      .catch(() => {
        if (!hadFirstLoad) renderUnavailable();
        // A single missed poll after a successful first load just keeps
        // showing the last good render rather than flashing to "unavailable".
      });
  }

  loadStatus();
  setInterval(loadStatus, POLL_MS);
})();

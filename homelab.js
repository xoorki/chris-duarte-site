(function () {
  // Status data lives on a separate branch (status-data), not main, so the
  // homelab's frequent pushes never trigger a GitHub Pages rebuild.
  const STATUS_URL =
    'https://raw.githubusercontent.com/xoorki/chris-duarte-site/status-data/status.json';
  const STALE_AFTER_MS = 15 * 60 * 1000; // 15 minutes
  const POLL_MS = 60 * 1000; // the homelab only reports every few minutes
  const DEMO_STEP_MS = 30 * 1000; // spacing of the sample history points
  const DEMO_POINTS = 48; // …so the sample chart covers the last 24 minutes
  const DEMO_REPAINT_MS = 5 * 1000; // redraw the sample data between fetches

  const grid = document.getElementById('statusGrid');
  const pillRow = document.getElementById('pillRow');
  const updatedEl = document.getElementById('statusUpdated');
  const staleNotice = document.getElementById('staleNotice');
  const demoNotice = document.getElementById('demoNotice');
  const liveDot = document.getElementById('liveDot');

  if (!grid) return;

  let pollTimer = null;
  let demoTimer = null;

  function el(id) {
    return document.getElementById(id);
  }

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

  function spanLabel(ms) {
    const mins = Math.round(ms / 60000);
    if (mins < 60) return mins + 'm';
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? hours + 'h ' + rem + 'm' : hours + 'h';
  }

  // status.json is fetched from outside this origin, so nothing in it is
  // trusted: the status string ends up in a class attribute, and only these
  // three values are ever allowed through.
  function safeStatus(status) {
    return status === 'up' || status === 'down' ? status : 'unknown';
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

  function setTile(tileId, valueId, text, level) {
    const tileEl = el(tileId);
    const valueEl = el(valueId);
    if (!tileEl || !valueEl) return;
    valueEl.textContent = text;
    tileEl.classList.remove('level-ok', 'level-mid', 'level-bad', 'level-neutral');
    if (level) tileEl.classList.add('level-' + level);
  }

  function setGauge(prefix, percent) {
    const arcEl = el(prefix + 'Arc');
    const valueEl = el(prefix + 'Value');
    const stateEl = el(prefix + 'State');
    if (!arcEl || !valueEl) return;

    const circumference = 2 * Math.PI * 58;
    arcEl.style.strokeDasharray = String(circumference);
    arcEl.classList.remove('gauge-arc-ok', 'gauge-arc-mid', 'gauge-arc-bad');

    if (typeof percent !== 'number') {
      arcEl.style.strokeDashoffset = String(circumference);
      valueEl.textContent = '—';
      if (stateEl) stateEl.textContent = '—';
      return;
    }

    const clamped = Math.max(0, Math.min(100, percent));
    arcEl.style.strokeDashoffset = String(circumference * (1 - clamped / 100));
    const level = usageLevel(clamped);
    arcEl.classList.add('gauge-arc-' + level);
    valueEl.textContent = Math.round(clamped) + '%';
    if (stateEl) stateEl.textContent = usageStateLabel(level);
  }

  // Draws the rolling history the homelab publishes alongside its status.
  // The scale follows the data rather than being pinned to 0-100, otherwise
  // an idle box sitting at 3% would just draw a flat line along the floor.
  function renderTrend(prefix, samples, spanMs) {
    const lineEl = el(prefix + 'Line');
    const areaEl = el(prefix + 'Area');
    const captionEl = el(prefix + 'Caption');
    if (!lineEl || !areaEl) return;

    const values = samples.filter((v) => typeof v === 'number');
    if (values.length < 2) {
      lineEl.setAttribute('d', '');
      areaEl.setAttribute('d', '');
      if (captionEl) captionEl.textContent = 'No history yet';
      return;
    }

    const W = 200;
    const H = 64;
    const pad = 5;
    const MIN_SPAN = 10; // never zoom in tighter than a 10-point band

    let min = Math.min.apply(null, values);
    let max = Math.max.apply(null, values);
    if (max - min < MIN_SPAN) {
      const mid = (max + min) / 2;
      min = Math.max(0, mid - MIN_SPAN / 2);
      max = min + MIN_SPAN;
    }

    const x = (i) => pad + (i / (values.length - 1)) * (W - pad * 2);
    const y = (v) => pad + (1 - (v - min) / (max - min)) * (H - pad * 2);

    let line = '';
    values.forEach((v, i) => {
      line += (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ',' + y(v).toFixed(1) + ' ';
    });
    lineEl.setAttribute('d', line.trim());
    areaEl.setAttribute(
      'd',
      'M' + x(0).toFixed(1) + ',' + H + ' ' + line.trim().slice(1) +
        'L' + x(values.length - 1).toFixed(1) + ',' + H + ' Z'
    );

    if (captionEl) {
      captionEl.textContent =
        Math.round(min) + '–' + Math.round(max) + '%' +
        (spanMs ? ' · last ' + spanLabel(spanMs) : '');
    }
  }

  function renderPills(services, stale) {
    if (!pillRow) return;
    pillRow.innerHTML = '';
    services.forEach((svc) => {
      const status = stale ? 'unknown' : safeStatus(svc.status);
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

  function renderCards(services, stale) {
    grid.innerHTML = '';
    services.forEach((svc) => {
      const status = stale ? 'unknown' : safeStatus(svc.status);
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

  // The homelab hasn't been built yet, so the status file on the data branch
  // is still a placeholder: no real samples, everything "unknown". Treat that
  // (and a missing file) as "show the sample dashboard", clearly labelled.
  function isPlaceholder(data) {
    if (!data || typeof data !== 'object' || !data.host) return true;
    const noHostNumbers =
      typeof data.host.cpu_percent !== 'number' &&
      typeof data.host.mem_percent !== 'number';
    const services = Array.isArray(data.services) ? data.services : [];
    const noRealStatuses =
      services.length > 0 &&
      services.every((s) => !s || (s.status !== 'up' && s.status !== 'down'));
    return noHostNumbers && noRealStatuses;
  }

  // Sample readings are a function of the wall clock rather than of the
  // array index, so the series scrolls and the numbers drift on every
  // repaint instead of redrawing the identical curve forever.
  function demoCurve(minutes, seed) {
    return (
      Math.sin(minutes / 4.1 + seed) * 0.55 +
      Math.sin(minutes / 1.7 + seed * 2.7) * 0.3 +
      Math.sin(minutes / 0.63 + seed * 4.3) * 0.15
    ); // roughly -1..1
  }

  function demoUptime(now) {
    // Wraps every 41 days, which reads like the occasional reboot.
    let mins = Math.floor((now % (41 * 24 * 3600 * 1000)) / 60000);
    const days = Math.floor(mins / (24 * 60));
    mins -= days * 24 * 60;
    const hours = Math.floor(mins / 60);
    return days + 'd ' + hours + 'h ' + (mins - hours * 60) + 'm';
  }

  function demoService(name, seed, base, spread, now) {
    const drift = Math.abs(demoCurve(now / 60000, seed));
    return {
      name: name,
      status: 'up',
      latency_ms: base + Math.round(drift * spread),
    };
  }

  function demoData() {
    const now = Date.now();
    const history = [];
    for (let i = DEMO_POINTS - 1; i >= 0; i--) {
      const minutes = (now - i * DEMO_STEP_MS) / 60000;
      history.push({
        t: new Date(now - i * DEMO_STEP_MS).toISOString(),
        cpu: Math.max(1, Math.round((9 + demoCurve(minutes, 0) * 7) * 10) / 10),
        mem: Math.max(1, Math.round((41 + demoCurve(minutes, 1.9) * 8) * 10) / 10),
      });
    }
    const latest = history[history.length - 1];
    return {
      updated_at: new Date(now).toISOString(),
      host: {
        cpu_percent: latest.cpu,
        mem_percent: latest.mem,
        uptime: demoUptime(now),
      },
      services: [
        demoService('Website', 0.4, 62, 40, now),
        demoService('Nextcloud', 1.3, 9, 12, now),
        demoService('Jellyfin', 2.1, 7, 9, now),
        demoService('Immich', 3.0, 13, 11, now),
        demoService('DNS', 3.8, 1, 3, now),
      ],
      history: history,
    };
  }

  function paint(data, mode) {
    const demo = mode === 'demo';
    const stale = !demo && Date.now() - new Date(data.updated_at).getTime() > STALE_AFTER_MS;
    // Shapes are checked rather than assumed — a malformed status.json
    // should leave the dashboard empty, not throw and leave it half-drawn.
    const host = data.host && typeof data.host === 'object' ? data.host : {};
    const services = (Array.isArray(data.services) ? data.services : []).filter(
      (s) => s && typeof s === 'object'
    );
    const history = (Array.isArray(data.history) ? data.history : []).filter(
      (h) => h && typeof h === 'object'
    );
    const cpu = typeof host.cpu_percent === 'number' ? host.cpu_percent : null;
    const mem = typeof host.mem_percent === 'number' ? host.mem_percent : null;

    if (demoNotice) demoNotice.hidden = !demo;
    if (staleNotice) staleNotice.hidden = demo || !stale;

    if (updatedEl) {
      updatedEl.textContent = demo
        ? 'Sample data — not live'
        : 'Last updated ' + timeAgo(data.updated_at);
    }
    setLiveDot(demo ? null : stale ? 'mid' : 'ok');

    setTile(
      'tileStatus',
      'tileStatusValue',
      demo ? 'Demo' : stale ? 'Stale' : 'Live',
      demo ? null : stale ? 'mid' : 'ok'
    );
    setTile(
      'tileUptime',
      'tileUptimeValue',
      host.uptime && !stale ? host.uptime : '—',
      host.uptime && !stale ? 'neutral' : null
    );

    const upCount = services.filter((s) => s.status === 'up').length;
    setTile(
      'tileServices',
      'tileServicesValue',
      services.length && !stale ? upCount + '/' + services.length + ' up' : '—',
      stale || !services.length
        ? null
        : upCount === services.length
          ? 'ok'
          : upCount === 0
            ? 'bad'
            : 'mid'
    );

    const latencies = services
      .filter((s) => s.status === 'up' && typeof s.latency_ms === 'number')
      .map((s) => s.latency_ms);
    const avgLatency = latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null;
    setTile(
      'tileLatency',
      'tileLatencyValue',
      avgLatency !== null && !stale ? avgLatency + ' ms' : '—',
      avgLatency !== null && !stale ? 'neutral' : null
    );

    setGauge('cpu', stale ? null : cpu);
    setGauge('mem', stale ? null : mem);

    let spanMs = 0;
    if (history.length > 1) {
      spanMs = new Date(history[history.length - 1].t).getTime() - new Date(history[0].t).getTime();
    }
    renderTrend('cpu', history.map((h) => h.cpu), spanMs);
    renderTrend('mem', history.map((h) => h.mem), spanMs);

    renderPills(services, stale);
    renderCards(services, stale);

    if (demo) {
      startDemoTicker();
    } else {
      stopDemoTicker();
    }
  }

  // Between fetches the sample dashboard redraws itself, so the demo reads
  // as something reporting in rather than a frozen screenshot.
  function startDemoTicker() {
    if (demoTimer) return;
    demoTimer = setInterval(function () {
      paint(demoData(), 'demo');
    }, DEMO_REPAINT_MS);
  }

  function stopDemoTicker() {
    clearInterval(demoTimer);
    demoTimer = null;
  }

  function loadStatus() {
    fetch(STATUS_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error('status fetch failed');
        return res.json();
      })
      .then((data) => {
        if (isPlaceholder(data)) {
          paint(demoData(), 'demo');
        } else {
          paint(data, 'live');
        }
      })
      .catch(() => {
        // No status file published yet (or it's unreachable) — the sample
        // dashboard is more useful than an empty one, as long as it says so.
        paint(demoData(), 'demo');
      });
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(loadStatus, POLL_MS);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
    stopDemoTicker();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else {
      loadStatus();
      startPolling();
    }
  });

  loadStatus();
  startPolling();
})();

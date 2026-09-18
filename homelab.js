(function () {
  // Status data lives on a separate branch (status-data), not main, so the
  // homelab's frequent pushes never trigger a GitHub Pages rebuild.
  const STATUS_URL =
    'https://raw.githubusercontent.com/xoorki/chris-duarte-site/status-data/status.json';
  const STALE_AFTER_MS = 15 * 60 * 1000; // 15 minutes

  const grid = document.getElementById('statusGrid');
  const updatedEl = document.getElementById('statusUpdated');
  const staleNotice = document.getElementById('staleNotice');
  const hostStats = document.getElementById('hostStats');

  if (!grid) return;

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

  function barLevel(percent) {
    if (percent >= 85) return 'high';
    if (percent >= 60) return 'mid';
    return 'low';
  }

  function renderHost(host, stale) {
    if (!hostStats) return;
    hostStats.innerHTML = '';

    if (!host || stale) {
      hostStats.hidden = true;
      return;
    }
    hostStats.hidden = false;

    const items = [];
    if (typeof host.cpu_percent === 'number') {
      items.push({ label: 'CPU', percent: host.cpu_percent });
    }
    if (typeof host.mem_percent === 'number') {
      items.push({ label: 'Memory', percent: host.mem_percent });
    }

    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'host-card';

      const top = document.createElement('div');
      top.className = 'host-card-top';

      const label = document.createElement('span');
      label.className = 'host-card-label';
      label.textContent = item.label;

      const value = document.createElement('span');
      value.className = 'host-card-value';
      value.textContent = Math.round(item.percent) + '%';

      top.appendChild(label);
      top.appendChild(value);

      const barTrack = document.createElement('div');
      barTrack.className = 'host-bar-track';
      const bar = document.createElement('div');
      bar.className = 'host-bar host-bar-' + barLevel(item.percent);
      bar.style.width = Math.max(0, Math.min(100, item.percent)) + '%';
      barTrack.appendChild(bar);

      card.appendChild(top);
      card.appendChild(barTrack);
      hostStats.appendChild(card);
    });

    if (host.uptime) {
      const card = document.createElement('div');
      card.className = 'host-card host-card-uptime';

      const label = document.createElement('span');
      label.className = 'host-card-label';
      label.textContent = 'Uptime';

      const value = document.createElement('span');
      value.className = 'host-card-value';
      value.textContent = host.uptime;

      card.appendChild(label);
      card.appendChild(value);
      hostStats.appendChild(card);
    }

    if (!items.length && !host.uptime) {
      hostStats.hidden = true;
    }
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

  fetch(STATUS_URL + '?t=' + Date.now(), { cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error('status fetch failed');
      return res.json();
    })
    .then((data) => {
      const stale = Date.now() - new Date(data.updated_at).getTime() > STALE_AFTER_MS;
      if (updatedEl) {
        updatedEl.textContent = 'Last updated ' + timeAgo(data.updated_at);
      }
      if (staleNotice) {
        staleNotice.hidden = !stale;
      }
      renderHost(data.host, stale);
      render(data.services || [], stale);
    })
    .catch(() => {
      if (updatedEl) updatedEl.textContent = 'Status unavailable';
      if (hostStats) hostStats.hidden = true;
      grid.innerHTML = '<p class="status-error">Couldn’t load status right now.</p>';
    });
})();

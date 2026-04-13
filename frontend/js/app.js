// =============================================================================
// PROJECT ANTIGRAVITY — Dashboard Application
// =============================================================================
// Vanilla JS SPA. Fetches from /api/v1. Auto-refreshes every 30s.
// Reflects database truth only. Distinguishes success/blocked/failed/partial.

(function () {
  'use strict';

  const API_BASE = '/api/v1';
  let eventSource = null;

  // -------------------------------------------------------------------------
  // API Client
  // -------------------------------------------------------------------------

  async function api(path, options = {}) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
      return data;
    } catch (err) {
      console.error(`[API] ${path} failed:`, err.message);
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Formatters
  // -------------------------------------------------------------------------

  function formatTime(utcStr) {
    if (!utcStr) return 'Never';
    const d = new Date(utcStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    // Full date in Guyana time (UTC-4)
    return d.toLocaleString('en-US', {
      timeZone: 'America/Guyana',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function formatCurrency(amount) {
    if (amount === null || amount === undefined) return '—';
    return '$' + parseFloat(amount).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function formatDuration(ms) {
    if (!ms) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function statusPillClass(status) {
    const map = {
      success: 'pill-success', failed: 'pill-failed', blocked: 'pill-blocked',
      partial: 'pill-partial', running: 'pill-running', pending: 'pill-pending',
      new: 'pill-new', matched: 'pill-matched', alerted: 'pill-alerted',
      sold: 'pill-sold', sent: 'pill-sent', delivered: 'pill-delivered',
      suppressed: 'pill-suppressed',
    };
    return map[status] || '';
  }

  function priorityPillClass(priority) {
    return priority === 'high' ? 'pill-high' : '';
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // -------------------------------------------------------------------------
  // Toast System
  // -------------------------------------------------------------------------

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-exit');
      toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
  }

  // -------------------------------------------------------------------------
  // Data Rendering
  // -------------------------------------------------------------------------

  // --- Real-time Data Loading instead of API fetch ---
  function handleStreamData(data) {
    if (data.status) {
      document.getElementById('last-refresh').textContent = new Date().toLocaleTimeString('en-US', {
        timeZone: 'America/Guyana',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
      renderSystemBadge(data.status);
      renderStats(data.status);
      renderRunIndicators(data.status.latestRuns || {});
    }
    if (data.hunts) renderHunts(data.hunts);
    if (data.lots) renderLots(data.lots);
    if (data.alerts) renderAlerts(data.alerts);
    if (data.logs) renderRunsTable(data.logs);
  }

  function startSSE() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(`${API_BASE}/status/stream`);
    
    eventSource.onopen = () => {
      showToast('Connected to live data stream', 'success');
      setSystemBadge('healthy', 'Connected');
    };
    
    eventSource.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload && payload.data) {
          handleStreamData(payload.data);
        }
      } catch (err) {
        console.error('SSE Parse Error', err);
      }
    };
    
    eventSource.onerror = () => {
      setSystemBadge('unknown', 'Disconnected');
      eventSource.close();
      // Auto reconnect after 5s
      setTimeout(startSSE, 5000);
    };
  }

  function renderSystemBadge(data) {
    const runs = data.latestRuns;
    const badge = document.getElementById('system-status-badge');
    const lock = data.currentLock;

    if (lock) {
      setSystemBadge('warning', 'Scraping...');
    } else if (runs.lastBlocked && !runs.lastSuccess) {
      setSystemBadge('critical', 'Blocked');
    } else if (runs.lastBlocked && runs.lastSuccess) {
      // Check if blocked is newer than success
      const blockedAt = new Date(runs.lastBlocked.started_at);
      const successAt = new Date(runs.lastSuccess.started_at);
      if (blockedAt > successAt) {
        setSystemBadge('blocked', 'Last Run Blocked');
      } else {
        setSystemBadge('healthy', 'Operational');
      }
    } else if (runs.lastFailed && !runs.lastSuccess) {
      setSystemBadge('critical', 'Failing');
    } else if (runs.lastSuccess) {
      setSystemBadge('healthy', 'Operational');
    } else {
      setSystemBadge('unknown', 'No Runs Yet');
    }
  }

  function setSystemBadge(state, label) {
    const badge = document.getElementById('system-status-badge');
    badge.className = `status-badge status-${state}`;
    badge.querySelector('.status-label').textContent = label;
  }

  function renderStats(data) {
    document.getElementById('stat-hunts-active').textContent = data.hunts?.active || 0;
    document.getElementById('stat-lots-total').textContent = data.lots?.total || 0;
    document.getElementById('stat-matches-count').textContent =
      (parseInt(data.lots?.matched_count || 0) + parseInt(data.lots?.alerted_count || 0));
    document.getElementById('stat-alerts-sent').textContent = data.alerts?.sent_count || 0;
  }

  function renderRunIndicators(runs) {
    document.getElementById('val-last-success').textContent =
      runs.lastSuccess ? formatTime(runs.lastSuccess.started_at) : 'Never';
    document.getElementById('val-last-blocked').textContent =
      runs.lastBlocked ? formatTime(runs.lastBlocked.started_at) : 'Never';
    document.getElementById('val-last-failed').textContent =
      runs.lastFailed ? formatTime(runs.lastFailed.started_at) : 'Never';
  }

  // loadRuns no longer calls API — handled by SSE

  function renderRunsTable(runs) {
    const tbody = document.getElementById('tbody-runs');
    if (!runs || runs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No runs recorded yet</td></tr>';
      return;
    }

    tbody.innerHTML = runs.map((run) => `
      <tr>
        <td><span class="pill ${statusPillClass(run.status)}">${escapeHtml(run.status)}</span></td>
        <td>${formatTime(run.started_at)}</td>
        <td>${run.lots_found || 0}</td>
        <td>${run.new_lots || 0}</td>
        <td>${run.alerts_sent || 0}</td>
        <td>${formatDuration(run.duration_ms)}</td>
      </tr>
    `).join('');
  }

  // loadHunts no longer calls API — handled by SSE

  function renderHunts(hunts) {
    const container = document.getElementById('hunts-list');
    if (!hunts || hunts.length === 0) {
      container.innerHTML = '<div class="empty-state">No hunts configured</div>';
      return;
    }

    container.innerHTML = hunts.map((hunt) => `
      <div class="hunt-card" data-hunt-id="${hunt.id}">
        <div class="hunt-info">
          <div class="hunt-name">${escapeHtml(hunt.name)}</div>
          <div class="hunt-details">
            ${escapeHtml(hunt.make)} ${escapeHtml(hunt.model)}
            ${hunt.year_min || hunt.year_max ? `· ${hunt.year_min || '?'}–${hunt.year_max || '?'}` : ''}
            ${hunt.body_style ? `· ${escapeHtml(hunt.body_style)}` : ''}
            ${hunt.max_bid ? `· Max $${parseFloat(hunt.max_bid).toLocaleString()}` : ''}
          </div>
        </div>
        <button class="hunt-toggle ${hunt.is_active ? 'active' : ''}"
                data-hunt-id="${hunt.id}"
                data-active="${hunt.is_active}"
                title="${hunt.is_active ? 'Deactivate' : 'Activate'}">
        </button>
      </div>
    `).join('');

    // Bind toggle handlers
    container.querySelectorAll('.hunt-toggle').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const huntId = btn.dataset.huntId;
        const willBeActive = btn.dataset.active !== 'true';
        try {
          await api(`/hunts/${huntId}`, {
            method: 'PATCH',
            body: JSON.stringify({ is_active: willBeActive }),
          });
          showToast(`Hunt ${willBeActive ? 'activated' : 'deactivated'}`, 'success');
          loadHunts();
        } catch (err) {
          showToast(`Failed to update hunt: ${err.message}`, 'error');
        }
      });
    });
  }

  // loadLots logic now just requests specific filtered logic 
  // since streaming is active, we just refetch if statusFilter changes
  async function reloadFilteredLots() {
    try {
      const statusFilter = document.getElementById('filter-lot-status').value;
      const params = statusFilter ? `?status=${statusFilter}` : '';
      const { data } = await api(`/lots${params}`);
      renderLots(data);
    } catch {
      document.getElementById('lots-feed').innerHTML =
        '<div class="empty-state">Failed to load lots</div>';
    }
  }

  function renderLots(lots) {
    const container = document.getElementById('lots-feed');
    if (!lots || lots.length === 0) {
      container.innerHTML = '<div class="empty-state">No vehicles tracked yet</div>';
      return;
    }

    container.innerHTML = lots.map((lot) => `
      <div class="lot-card">
        <div class="lot-thumb">
          ${lot.image_url
            ? `<img src="${escapeHtml(lot.image_url)}" alt="${escapeHtml(lot.title)}" loading="lazy">`
            : '🚗'}
        </div>
        <div class="lot-info">
          <div class="lot-title">${escapeHtml(lot.title || `${lot.year || ''} ${lot.make || ''} ${lot.model || ''}`.trim())}</div>
          <div class="lot-meta">
            <span>📍 ${escapeHtml(lot.location || 'Unknown')}</span>
            <span>🏷 #${escapeHtml(lot.lot_number)}</span>
            ${lot.sale_date ? `<span>📅 ${formatTime(lot.sale_date)}</span>` : ''}
            ${lot.damage_type ? `<span>⚠️ ${escapeHtml(lot.damage_type)}</span>` : ''}
          </div>
        </div>
        <div class="lot-badge">
          <span class="lot-price">${formatCurrency(lot.current_bid)}</span>
          ${lot.buy_now_price ? `<span class="lot-price" style="color:var(--status-warning);font-size:0.72rem;">BN ${formatCurrency(lot.buy_now_price)}</span>` : ''}
          <span class="pill ${statusPillClass(lot.status)}">${escapeHtml(lot.status)}</span>
          <span class="lot-confidence">${Math.round((lot.match_confidence || 0) * 100)}%</span>
        </div>
      </div>
    `).join('');
  }

  // loadAlerts no longer calls API — handled by SSE

  function renderAlerts(alerts) {
    const container = document.getElementById('alerts-timeline');
    if (!alerts || alerts.length === 0) {
      container.innerHTML = '<div class="empty-state">No alerts sent yet</div>';
      return;
    }

    const icons = {
      sent: '✅', delivered: '✅', failed: '❌',
      suppressed: '⏭️', pending: '⏳',
    };

    container.innerHTML = alerts.map((alert) => `
      <div class="alert-item alert-${alert.status}">
        <span class="alert-icon">${icons[alert.status] || '📲'}</span>
        <div class="alert-content">
          <div class="alert-title">
            ${escapeHtml(alert.title || `Lot #${alert.lot_number}`)}
            ${alert.priority === 'high' ? '<span class="pill pill-high">HIGH</span>' : ''}
          </div>
          <div class="alert-detail">
            ${escapeHtml(alert.channel)} → ${escapeHtml(alert.recipient)}
            ${alert.hunt_name ? `· ${escapeHtml(alert.hunt_name)}` : ''}
          </div>
        </div>
        <span class="alert-time">${formatTime(alert.sent_at)}</span>
      </div>
    `).join('');
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async function triggerScrape() {
    const btn = document.getElementById('btn-trigger-scrape');
    btn.disabled = true;
    btn.textContent = 'Running...';

    try {
      showToast('Scrape triggered — this may take a minute', 'info');
      const result = await api('/scrape/trigger', { method: 'POST' });
      showToast(`Scrape complete: ${result.data?.status || 'done'}`, 'success');
      // Stream handles refresh
    } catch (err) {
      showToast(`Scrape failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Trigger Scrape
      `;
    }
  }

  async function addHunt(e) {
    e.preventDefault();
    const form = e.target;

    const keywords = document.getElementById('hunt-keywords').value;

    const hunt = {
      name: document.getElementById('hunt-name').value.trim(),
      make: document.getElementById('hunt-make').value.trim(),
      model: document.getElementById('hunt-model').value.trim(),
      year_min: parseInt(document.getElementById('hunt-year-min').value) || null,
      year_max: parseInt(document.getElementById('hunt-year-max').value) || null,
      body_style: document.getElementById('hunt-body-style').value.trim() || null,
      max_bid: parseFloat(document.getElementById('hunt-max-bid').value) || null,
      keywords: keywords ? keywords.split(',').map((k) => k.trim()).filter(Boolean) : [],
    };

    try {
      await api('/hunts', { method: 'POST', body: JSON.stringify(hunt) });
      showToast('Hunt created successfully', 'success');
      closeModal();
      form.reset();
      // SSE automatically refreshes data next tick or we can force load status
    } catch (err) {
      showToast(`Failed to create hunt: ${err.message}`, 'error');
    }
  }

  function openModal() {
    document.getElementById('modal-add-hunt').style.display = 'flex';
  }

  function closeModal() {
    document.getElementById('modal-add-hunt').style.display = 'none';
  }

  // -------------------------------------------------------------------------
  // Onboarding Tour
  // -------------------------------------------------------------------------
  
  const tourSteps = [
    { title: '1. Dashboard Status', content: 'Check the Connection Status and high-level stats at the top of the interface. This gives you a quick overview of system health and tracked lots.' },
    { title: '2. Active Hunts', content: 'Use the "Active Hunts" panel to define your target search criteria. Add parameters like Make, Model, and Max Bid. The system searches for these automatically.' },
    { title: '3. Pipeline Runs', content: 'The "Pipeline Runs" panel shows automated execution history. You can also manually kick off a job by clicking the "Trigger Scrape" button.' },
    { title: '4. Matched Vehicles & Alerts', content: 'When a vehicle matches your Hunt, it appears in "Matched Vehicles". Important notifications and SMS/WhatsApp messages are tracked in the "Alert Timeline".' }
  ];
  let currentTourStep = 0;

  function showTourStep(index) {
    currentTourStep = index;
    const step = tourSteps[index];
    document.getElementById('tour-content').innerHTML = `
      <h4 style="margin-bottom: 8px; color: var(--accent-blue);">${step.title}</h4>
      <p style="color: var(--text-secondary); font-size: 0.85rem; line-height: 1.5;">${step.content}</p>
    `;
    
    const dots = document.getElementById('tour-dots');
    dots.innerHTML = tourSteps.map((_, i) => `<span class="dot ${i === index ? 'active' : ''}"></span>`).join('');
    
    document.getElementById('btn-tour-prev').style.visibility = index === 0 ? 'hidden' : 'visible';
    const nextBtn = document.getElementById('btn-tour-next');
    if (index === tourSteps.length - 1) {
      nextBtn.textContent = 'Finish';
    } else {
      nextBtn.textContent = 'Next';
    }
  }

  function nextTourStep() {
    if (currentTourStep < tourSteps.length - 1) {
      showTourStep(currentTourStep + 1);
    } else {
      closeTour();
    }
  }

  function prevTourStep() {
    if (currentTourStep > 0) {
      showTourStep(currentTourStep - 1);
    }
  }

  function openTour() {
    currentTourStep = 0;
    showTourStep(0);
    document.getElementById('modal-onboarding').style.display = 'flex';
  }

  function closeTour() {
    document.getElementById('modal-onboarding').style.display = 'none';
    localStorage.setItem('antigravity_tour_seen', 'true');
  }

  // -------------------------------------------------------------------------
  // Refresh
  // -------------------------------------------------------------------------

  function refreshAll() {
    startSSE();
  }

  function startAutoRefresh() {
    // Intentionally empty. SSE is handled globally.
  }

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  function init() {
    // Bind events
    document.getElementById('btn-refresh').addEventListener('click', refreshAll);
    document.getElementById('btn-trigger-scrape').addEventListener('click', triggerScrape);
    document.getElementById('btn-add-hunt').addEventListener('click', openModal);
    document.getElementById('btn-close-modal').addEventListener('click', closeModal);
    document.getElementById('btn-cancel-hunt').addEventListener('click', closeModal);
    document.getElementById('form-add-hunt').addEventListener('submit', addHunt);
    document.getElementById('filter-lot-status').addEventListener('change', reloadFilteredLots);
    
    document.getElementById('btn-tour').addEventListener('click', openTour);
    document.getElementById('btn-close-tour').addEventListener('click', closeTour);
    document.getElementById('btn-tour-next').addEventListener('click', nextTourStep);
    document.getElementById('btn-tour-prev').addEventListener('click', prevTourStep);

    // Close modal on overlay click
    document.getElementById('modal-add-hunt').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) closeModal();
    });
    document.getElementById('modal-onboarding').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) closeTour();
    });

    // Initial load
    startSSE();
    
    // Show tour if first time
    if (!localStorage.getItem('antigravity_tour_seen')) {
      setTimeout(openTour, 500);
    }
  }

  // Go
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

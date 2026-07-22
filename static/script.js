/**
 * Work Log Harness — Frontend (Enterprise UI)
 *
 * SPA với:
 * - Dashboard: sidebar, topbar, hero, stat cards, filters, table
 * - Modal manual entry + settings
 * - Export Excel + class action
 * - ✨ AI: classify, enhance, summary, chat
 * - Auto-refresh 30s
 * - Dark mode, command palette, keyboard shortcuts
 */
(function () {
  "use strict";

  // ─── State ─────────────────────────────────────────
  const state = {
    page: 1,
    pageSize: 50,
    source: "",
    activityType: "",
    dateFrom: "",
    dateTo: "",
    search: "",
    sortBy: "activity_timestamp",
    sortOrder: "desc",
    total: 0,
    aiEnabled: false,
    theme: "light",
  };

  let editingId = null;

  // ─── Bootstrap Modal instances ─────────────────────
  let _manualModal = null;
  let _settingsModal = null;

  function getManualModal() {
    if (!_manualModal) _manualModal = new bootstrap.Modal("#manual-modal");
    return _manualModal;
  }
  function getSettingsModal() {
    if (!_settingsModal) _settingsModal = new bootstrap.Modal("#settings-modal");
    return _settingsModal;
  }

  // ─── DOM refs ──────────────────────────────────────

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const tableBody = $("#logs-tbody");
  const tableInfo = $("#table-info");
  const pagination = $("#pagination");

  const filterSource = $("#filter-source");
  const filterType = $("#filter-type");
  const filterFrom = $("#filter-from");
  const filterTo = $("#filter-to");
  const filterSearch = $("#filter-search");

  const manualForm = $("#manual-form");
  const settingsForm = $("#settings-form");

  const aiToolbar = $("#ai-toolbar");
  const chatPanel = $("#chat-panel");
  const summaryPanel = $("#summary-panel");

  // ─── Theme ─────────────────────────────────────────

  function loadTheme() {
    try {
      state.theme = localStorage.getItem("wlh-theme") || "light";
    } catch (_) { /* ignore */ }
    document.documentElement.setAttribute("data-theme", state.theme);
  }

  function saveTheme() {
    try { localStorage.setItem("wlh-theme", state.theme); } catch (_) { /* ignore */ }
  }

  function toggleTheme() {
    state.theme = state.theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", state.theme);
    saveTheme();
    const icon = document.querySelector("#theme-toggle-btn i");
    if (icon) {
      icon.className = state.theme === "dark" ? "bi bi-sun" : "bi bi-moon-stars";
    }
  }

  // ─── Sidebar ───────────────────────────────────────

  function toggleSidebar() {
    const sidebar = $("#app-sidebar");
    const overlay = $("#sidebar-overlay");
    if (!sidebar) return;
    const expanded = sidebar.getAttribute("data-expanded") === "true";
    if (window.innerWidth < 768) {
      // Mobile off-canvas
      sidebar.style.transform = expanded ? "" : "translateX(0)";
      sidebar.setAttribute("data-expanded", expanded ? "false" : "true");
      if (overlay) overlay.classList.toggle("active");
    } else {
      // Desktop expand/collapse
      sidebar.setAttribute("data-expanded", expanded ? "false" : "true");
    }
  }

  // ─── Command Palette ───────────────────────────────

  function openCmdPalette() {
    const backdrop = $("#cmd-backdrop");
    const modal = $("#cmd-modal");
    if (!backdrop || !modal) return;
    backdrop.classList.add("active");
    modal.classList.add("active");
    setTimeout(() => {
      const input = $("#cmd-input");
      if (input) input.focus();
    }, 150);
  }

  function closeCmdPalette() {
    const backdrop = $("#cmd-backdrop");
    const modal = $("#cmd-modal");
    if (backdrop) backdrop.classList.remove("active");
    if (modal) modal.classList.remove("active");
  }

  // ─── Filter toggle (mobile) ────────────────────────

  function toggleFilterRow() {
    const row = $("#filter-row");
    if (!row) return;
    row.classList.toggle("open");
  }

  // ─── Quick filter by source ────────────────────────

  function filterBySource(source) {
    filterSource.value = source;
    applyFilters();
    // Scroll to table on mobile
    if (window.innerWidth < 768) {
      $(".table-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function resetFilters() {
    filterSource.value = "";
    filterType.value = "";
    filterFrom.value = "";
    filterTo.value = "";
    filterSearch.value = "";
    applyFilters();
  }

  // ─── Toast ─────────────────────────────────────────

  function showToast(message, type = "info") {
    const container = $("#toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast-custom ${type}`;
    toast.innerHTML = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.3s";
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ─── Formatting helpers ────────────────────────────

  function formatDate(isoStr) {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatTime(minutes) {
    if (!minutes) return "-";
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function badgeClass(source) {
    return `source-badge sb-${source}`;
  }

  function activityTypeLabel(type) {
    const labels = {
      ticket_update: "Update", comment: "Comment",
      estimation_change: "Estimation", status_change: "Status",
      worklog: "Worklog", commit: "Commit", push: "Push",
      pr_create: "PR Create", pr_merge: "PR Merge", pr_comment: "PR Comment",
      local_commit: "Local Commit", meeting: "Meeting",
      code_review: "Code Review", research: "Research", other: "Other",
    };
    return labels[type] || type;
  }

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Sparkline helper ──────────────────────────────

  function renderSparkline(elemId, data, color = "#4F46E5") {
    const container = document.getElementById(elemId);
    if (!container || !data || data.length < 2) return;
    const w = 120, h = 28;
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const pts = data.map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    });
    const pathD = pts.reduce((acc, p, i) => acc + (i === 0 ? "M" : "L") + p, "");
    const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="${pathD}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.8"/>
      <path d="${pathD}" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.12"/>
    </svg>`;
    container.innerHTML = svg;
  }

  // ─── Animated counter ──────────────────────────────

  function animateCounter(elemId, target, suffix = "") {
    const el = document.getElementById(elemId);
    if (!el) return;
    const start = 0;
    const duration = 800;
    const startTime = performance.now();

    function step(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (target - start) * eased);
      el.textContent = current + suffix;
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ─── Loading helpers ───────────────────────────────

  let _loadingStack = 0;

  function showLoading(message = "Processing...") {
    _loadingStack++;
    const overlay = document.getElementById("loading-overlay");
    const text = document.getElementById("loading-text");
    if (overlay && text) {
      text.textContent = message;
      overlay.classList.add("active");
    }
  }

  function hideLoading() {
    _loadingStack = Math.max(0, _loadingStack - 1);
    if (_loadingStack === 0) {
      const overlay = document.getElementById("loading-overlay");
      if (overlay) overlay.classList.remove("active");
    }
  }

  async function withLoading(message, fn) {
    showLoading(message);
    try {
      return await fn();
    } finally {
      hideLoading();
    }
  }

  async function withButtonLoading(btn, loadingText, fn) {
    const origHTML = btn.innerHTML;
    const origDisabled = btn.disabled;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> ${loadingText}`;
    try {
      return await fn();
    } finally {
      btn.disabled = origDisabled;
      btn.innerHTML = origHTML;
    }
  }

  // ─── Panel toggles ───────────────────────────────

  function toggleAIPanel() {
    const body = $("#ai-body");
    const toggle = $("#ai-toggle-icon");
    if (!body) return;
    const isHidden = body.style.display === "none" || body.style.display === "";
    body.style.display = isHidden ? "block" : "none";
    if (toggle) toggle.style.transform = isHidden ? "rotate(0deg)" : "rotate(-180deg)";
  }

  // ─── API calls ─────────────────────────────────────

  async function fetchLogs() {
    const params = new URLSearchParams({
      page: state.page,
      page_size: state.pageSize,
      sort_by: state.sortBy,
      sort_order: state.sortOrder,
    });
    if (state.source) params.set("source", state.source);
    if (state.activityType) params.set("activity_type", state.activityType);
    if (state.dateFrom) params.set("from", state.dateFrom);
    if (state.dateTo) params.set("to", state.dateTo);
    if (state.search) params.set("search", state.search);
    const res = await fetch(`/api/logs?${params}`);
    if (!res.ok) throw new Error("Failed to fetch logs");
    return res.json();
  }

  async function fetchStats() {
    const res = await fetch("/api/logs/stats");
    if (!res.ok) throw new Error("Failed to fetch stats");
    return res.json();
  }

  async function deleteLog(id) {
    const res = await fetch(`/api/logs/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete log");
  }

  async function createLog(data) {
    const res = await fetch("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to create log");
    }
    return res.json();
  }

  async function updateLog(id, data) {
    const res = await fetch(`/api/logs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to update log");
    return res.json();
  }

  async function fetchSettings() {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new Error("Failed to fetch settings");
    return res.json();
  }

  async function saveSettings(items) {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items),
    });
    if (!res.ok) throw new Error("Failed to save settings");
    return res.json();
  }

  async function testConnection(data) {
    const res = await fetch("/api/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Test failed");
    return res.json();
  }

  async function classifyLog(id) {
    const res = await fetch(`/api/ai/classify/${id}`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Classification failed");
    }
    return res.json();
  }

  async function classifyBatch(ids = null) {
    const res = await fetch("/api/ai/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids ? { log_ids: ids } : {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Batch classification failed");
    }
    return res.json();
  }

  async function fetchSummary(data) {
    const res = await fetch("/api/ai/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Summary generation failed");
    }
    return res.json();
  }

  async function askAI(query, date_from, date_to) {
    const res = await fetch("/api/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, date_from, date_to }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "AI analysis failed");
    }
    return res.json();
  }

  // ─── AI Settings UI ────────────────────────────────

  const PROVIDER_PRESETS = {
    openai: {
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o",
      key_hint: 'Get key at <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com/api-keys</a>',
      model_hint: "Models: gpt-4o, gpt-4o-mini, gpt-4-turbo",
    },
    gemini: {
      base_url: "https://generativelanguage.googleapis.com/v1beta/openai/",
      model: "gemini-2.0-flash",
      key_hint: 'Get free API key at <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a>',
      model_hint: "Models: gemini-2.0-flash, gemini-2.5-pro, gemini-1.5-pro",
    },
    anthropic: {
      base_url: "https://api.anthropic.com/v1",
      model: "claude-sonnet-4-20250514",
      key_hint: 'Get key at <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a>',
      model_hint: "Models: claude-sonnet-4-20250514, claude-3-5-sonnet-20241022",
    },
    openrouter: {
      base_url: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o",
      key_hint: 'Get key at <a href="https://openrouter.ai/keys" target="_blank">openrouter.ai/keys</a>',
      model_hint: "Thousands of models available",
    },
    deepseek: {
      base_url: "https://api.deepseek.com",
      model: "deepseek-chat",
      key_hint: 'Get key at <a href="https://platform.deepseek.com" target="_blank">platform.deepseek.com</a>',
      model_hint: "Models: deepseek-chat, deepseek-reasoner",
    },
    custom: {
      base_url: "",
      model: "",
      key_hint: "Enter your API key",
      model_hint: "Enter any OpenAI-compatible model name",
    },
  };

  function onProviderChange() {
    const provider = document.getElementById("setting-ai-provider").value;
    const preset = PROVIDER_PRESETS[provider];
    if (!preset) return;

    const urlField = document.getElementById("setting-ai-base-url");
    if (!urlField.value || Object.keys(PROVIDER_PRESETS).some(
      (p) => PROVIDER_PRESETS[p].base_url === urlField.value
    )) {
      urlField.value = preset.base_url;
    }

    const modelField = document.getElementById("setting-ai-model");
    if (!modelField.value || Object.keys(PROVIDER_PRESETS).some(
      (p) => PROVIDER_PRESETS[p].model === modelField.value
    )) {
      modelField.value = preset.model;
    }

    const hint = document.getElementById("ai-key-hint");
    if (hint && preset.key_hint) hint.innerHTML = preset.key_hint;

    const modelHint = document.getElementById("ai-model-hint");
    if (modelHint && preset.model_hint) modelHint.textContent = preset.model_hint;
  }

  function toggleApiKeyVisibility() {
    const keyField = document.getElementById("setting-ai-api-key");
    const icon = document.querySelector("#btn-toggle-key i");
    if (keyField.type === "password") {
      keyField.type = "text";
      icon.className = "bi bi-eye-slash";
    } else {
      keyField.type = "password";
      icon.className = "bi bi-eye";
    }
  }

  async function loadSettings() {
    try {
      const data = await fetchSettings();
      const s = data.settings || {};

      const enabledField = document.getElementById("setting-ai-enabled");
      if (enabledField) enabledField.value = s.ai_enabled || "false";
      const providerField = document.getElementById("setting-ai-provider");
      if (providerField) providerField.value = s.ai_provider || "openai";
      const keyField = document.getElementById("setting-ai-api-key");
      if (keyField) keyField.value = s.ai_api_key || "";
      const baseUrlField = document.getElementById("setting-ai-base-url");
      if (baseUrlField) baseUrlField.value = s.ai_base_url || "";
      const modelField = document.getElementById("setting-ai-model");
      if (modelField) modelField.value = s.ai_model || "";

      onProviderChange();

      state.aiEnabled = s.ai_enabled === "true" && !!s.ai_api_key;
      updateAIUI();
    } catch (err) {
      console.warn("Settings load deferred (may load later).");
    }
  }

  function updateAIUI() {
    // Keep AI panel visible always — it's part of the layout
    const inlineBadge = $("#ai-status-inline");
    if (state.aiEnabled) {
      if (inlineBadge) inlineBadge.style.display = "inline-flex";
    } else {
      if (inlineBadge) inlineBadge.style.display = "none";
    }
  }

  async function handleSettingsSave(e) {
    e.preventDefault();

    const items = [
      { key: "ai_enabled", value: document.getElementById("setting-ai-enabled").value },
      { key: "ai_provider", value: document.getElementById("setting-ai-provider").value },
      { key: "ai_api_key", value: document.getElementById("setting-ai-api-key").value },
      { key: "ai_base_url", value: document.getElementById("setting-ai-base-url").value },
      { key: "ai_model", value: document.getElementById("setting-ai-model").value },
    ];

    await withButtonLoading(
      document.getElementById("btn-save-settings"),
      "Saving...",
      async () => {
        await saveSettings(items);
        showToast("✅ AI settings saved!", "success");
        getSettingsModal().hide();
        await loadSettings();
      }
    );
  }

  async function testAIConnection() {
    const btn = document.getElementById("btn-test-ai");
    const result = document.getElementById("ai-test-result");
    const modelStatus = document.getElementById("model-load-status");

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Testing...';
    result.textContent = "";
    result.style.color = "#64748b";
    if (modelStatus) modelStatus.textContent = "";

    const data = {
      provider: document.getElementById("setting-ai-provider").value,
      api_key: document.getElementById("setting-ai-api-key").value,
      base_url: document.getElementById("setting-ai-base-url").value,
      model: document.getElementById("setting-ai-model").value,
    };

    if (!data.api_key) {
      result.textContent = "⚠️ Please enter an API key first";
      result.style.color = "#dc3545";
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-plug me-1"></i>Test Connection & Load Models';
      return;
    }

    try {
      const res = await testConnection(data);
      if (res.status === "success") {
        const connMsg = res.models && res.models.length > 0
          ? `✅ Connected! Found ${res.models.length} models`
          : `✅ Connected!${res.response ? ` Response: "${res.response}"` : ""}`;
        result.textContent = connMsg;
        result.style.color = "#28a745";

        if (res.models && res.models.length > 0) {
          populateModelDropdown(res.models, res.suggested_model);
          if (modelStatus) {
            modelStatus.textContent = `✅ Loaded ${res.models.length} models`;
            modelStatus.style.color = "#28a745";
          }
        } else {
          if (modelStatus) {
            modelStatus.textContent = "ℹ️ No models list available. You can type the model name manually.";
            modelStatus.style.color = "#64748b";
          }
        }
      } else {
        result.textContent = `❌ ${res.message || "Connection failed"}`;
        result.style.color = "#dc3545";
        restoreModelInput();
      }
    } catch (err) {
      result.textContent = `❌ ${err.message}`;
      result.style.color = "#dc3545";
      restoreModelInput();
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-plug me-1"></i>Test Connection & Load Models';
  }

  function populateModelDropdown(models, suggested) {
    const wrapper = document.getElementById("model-input-wrapper");
    const currentVal = document.getElementById("setting-ai-model").value;

    let html = '<select class="form-select" id="setting-ai-model">';
    let hasMatch = false;
    for (const m of models) {
      const selected = m.id === suggested || m.id === currentVal ? "selected" : "";
      if (selected) hasMatch = true;
      const label = m.owned_by ? `${m.id} (${m.owned_by})` : m.id;
      html += `<option value="${m.id}" ${selected}>${label}</option>`;
    }
    html += '<option value="__custom__">✦ Custom model...</option>';
    html += "</select>";

    wrapper.innerHTML = html;

    const select = document.getElementById("setting-ai-model");
    select.addEventListener("change", function () {
      if (this.value === "__custom__") {
        const manual = prompt("Enter model name:");
        if (manual) {
          const opt = document.createElement("option");
          opt.value = manual;
          opt.textContent = `✦ ${manual}`;
          opt.selected = true;
          this.insertBefore(opt, this.querySelector('[value="__custom__"]'));
        } else {
          this.selectedIndex = 0;
        }
      }
    });

    const hint = document.getElementById("ai-model-hint");
    if (hint) {
      hint.textContent = `✅ ${models.length} models loaded from API. Select or choose "Custom model..." to type manually.`;
    }
  }

  function restoreModelInput() {
    const wrapper = document.getElementById("model-input-wrapper");
    const select = document.getElementById("setting-ai-model");
    const currentVal = select ? select.value : "";
    wrapper.innerHTML = `<input type="text" class="form-control" id="setting-ai-model" placeholder="gpt-4o (click Test Connection để tải danh sách)" value="${currentVal}" />`;
  }

  // ─── AI Actions ────────────────────────────────────

  async function handleClassifySingle(logId) {
    await withLoading("✨ Classifying entry...", async () => {
      const result = await classifyLog(logId);
      showToast(
        `✨ Classified: "${result.category}" (${Math.round(result.confidence * 100)}% confidence)`,
        "success"
      );
      loadData();
    });
  }

  async function classifyUnclassified() {
    const btn = document.getElementById("btn-ai-classify");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Classifying...';

    try {
      await withLoading("✨ Auto-classifying entries...", async () => {
        const result = await classifyBatch();
        const count = result.results ? result.results.length : 0;
        const highConf = result.results
          ? result.results.filter((r) => r.confidence > 0.5).length
          : 0;
        showToast(`✨ Classified ${count} entries (${highConf} with high confidence)`, "success");
        loadData();
      });
    } catch (err) {
      showToast(`Error: ${err.message}`, "error");
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-magic"></i> Auto-Classify';
  }

  async function handleEnhanceSingle(logId) {
    if (!confirm("🪄 AI Enhance this entry? (rewrite description + estimate time)")) return;
    await withLoading("🪄 Enhancing entry...", async () => {
      const res = await fetch(`/api/ai/enhance/${logId}`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).detail || "Enhance failed");
      await loadData();
      showToast("✅ Entry enhanced!", "success");
    });
  }

  async function enhanceBatch() {
    const btn = document.getElementById("btn-ai-enhance");
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Enhancing...';
    try {
      const res = await fetch("/api/ai/enhance", { method: "POST", headers: {"Content-Type": "application/json"}, body: "{}" });
      if (!res.ok) throw new Error((await res.json()).detail || "Enhance failed");
      await loadData();
      showToast("✅ Batch enhance complete!", "success");
    } catch (err) {
      showToast(`❌ ${err.message}`, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-wand"></i> Auto-Enhance';
    }
  }

  function openSummaryPanel() {
    summaryPanel.style.display = "block";
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    document.getElementById("summary-from").value = weekAgo;
    document.getElementById("summary-to").value = today;
    document.getElementById("summary-result").innerHTML =
      '<span class="text-muted fst-italic">Click Generate to create AI summary.</span>';
    summaryPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeSummaryPanel() {
    summaryPanel.style.display = "none";
  }

  async function generateSummary() {
    const resultDiv = document.getElementById("summary-result");
    resultDiv.innerHTML = '<div class="spinner-border spinner-border-sm me-1"></div> Generating...';

    const from = document.getElementById("summary-from").value;
    const to = document.getElementById("summary-to").value;

    try {
      const data = await fetchSummary({
        date_from: from ? new Date(from).toISOString() : null,
        date_to: to ? new Date(to + "T23:59:59").toISOString() : null,
        period: "daily",
      });
      resultDiv.innerHTML = `<strong>📊 ${data.log_count} entries found</strong>\n\n${data.summary}`;
    } catch (err) {
      resultDiv.innerHTML = `<span style="color:#dc3545">❌ ${err.message}</span>`;
    }
  }

  function toggleChatPanel() {
    if (chatPanel.style.display === "none") {
      chatPanel.style.display = "block";
      chatPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      chatPanel.style.display = "none";
    }
  }

  function addChatMessage(content, role = "bot") {
    const container = document.getElementById("chat-messages");
    const msg = document.createElement("div");
    msg.className = `chat-msg ${role}`;
    msg.innerHTML = content;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  }

  async function sendChatMessage() {
    if (sendChatMessage._busy) return;
    const input = document.getElementById("chat-input");
    const query = input.value.trim();
    if (!query) return;

    sendChatMessage._busy = true;
    addChatMessage(query, "user");
    input.value = "";
    addChatMessage("⏳ Thinking...", "bot");

    const msgs = document.getElementById("chat-messages");
    const thinkingMsg = msgs.lastElementChild;

    try {
      const data = await askAI(query);
      if (thinkingMsg) thinkingMsg.remove();
      addChatMessage(data.answer, "bot");
    } catch (err) {
      if (thinkingMsg) thinkingMsg.remove();
      addChatMessage(`❌ Error: ${err.message}`, "bot");
    } finally {
      sendChatMessage._busy = false;
    }
  }

  // ─── Render ────────────────────────────────────────

  function renderSkeleton() {
    // Show skeleton rows during loading
    tableBody.innerHTML = Array.from({ length: 6 }, () => `
      <tr>
        <td><div class="skeleton" style="height:16px;width:60px"></div></td>
        <td><div class="skeleton" style="height:16px;width:70px"></div></td>
        <td><div class="skeleton" style="height:16px;width:200px"></div><div class="skeleton" style="height:12px;width:140px;margin-top:6px"></div></td>
        <td><div class="skeleton" style="height:16px;width:80px"></div></td>
        <td><div class="skeleton" style="height:16px;width:120px"></div></td>
        <td><div class="skeleton" style="height:16px;width:50px"></div></td>
        <td><div class="skeleton" style="height:16px;width:40px"></div></td>
      </tr>
    `).join("");
  }

  function renderTable(data) {
    const { items, total, page } = data;
    state.total = total;

    if (!items || items.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="7">
            <div class="text-center py-5">
              <div style="font-size:48px;margin-bottom:8px">📋</div>
              <h5 class="fw-semibold">No work logs yet</h5>
              <p class="text-muted" style="font-size:13px">Configure Jira/Bitbucket in .env or add manual entries.</p>
            </div>
          </td>
        </tr>`;
      tableInfo.textContent = "0 entries";
      pagination.innerHTML = "";
      return;
    }

    tableBody.innerHTML = items
      .map(
        (log) => `
      <tr>
        <td><span class="${badgeClass(log.source)}">${escapeHtml(log.source)}</span></td>
        <td><span class="type-badge">${activityTypeLabel(log.activity_type)}</span></td>
        <td class="cell-title">
          ${log.url
            ? `<a href="${escapeHtml(log.url)}" target="_blank" title="${escapeHtml(log.title)}">${escapeHtml(log.title)}</a>`
            : `<span title="${escapeHtml(log.title)}">${escapeHtml(log.title)}</span>`}
          ${log.description
            ? `<div class="cell-desc" title="${escapeHtml(log.description)}">${escapeHtml(log.description)}</div>`
            : ""}
        </td>
        <td>${escapeHtml(log.project || "-")}</td>
        <td class="cell-date">${formatDate(log.activity_timestamp)}</td>
        <td class="cell-time${log.time_spent_minutes ? " has-value" : ""}">${formatTime(log.time_spent_minutes)}</td>
        <td class="cell-actions">
          <div class="dropdown">
            <button class="row-action-btn dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false" title="Actions"><i class="bi bi-three-dots-vertical"></i></button>
            <ul class="dropdown-menu dropdown-menu-end" style="min-width:160px;font-size:13px;padding:4px">
              <li><a class="dropdown-item" href="#" onclick="window.__editLog(${log.id});return false"><i class="bi bi-pencil me-2"></i>Edit</a></li>
              <li><a class="dropdown-item" href="#" onclick="window.__deleteLog(${log.id});return false"><i class="bi bi-trash me-2"></i>Delete</a></li>
              ${state.aiEnabled ? `
              <li><hr class="dropdown-divider"></li>
              <li><a class="dropdown-item" href="#" onclick="window.__classifySingle(${log.id});return false"><span class="me-2">✨</span>Classify</a></li>
              <li><a class="dropdown-item" href="#" onclick="window.__enhanceSingle(${log.id});return false"><span class="me-2">🪄</span>Enhance</a></li>
              ` : ""}
            </ul>
          </div>
        </td>
      </tr>`
      )
      .join("");

    // Initialize Bootstrap dropdowns for dynamic rows
    tableBody.querySelectorAll('[data-bs-toggle="dropdown"]').forEach(el => {
      try { new bootstrap.Dropdown(el); } catch (_) {}
    });

    const start = Math.min((page - 1) * state.pageSize + 1, total);
    const end = Math.min(page * state.pageSize, total);
    const showPlural = total !== 1 ? "entries" : "entry";
    tableInfo.textContent = `${start}–${end} of ${total} ${showPlural}`;

    renderPagination(total);
  }

  function renderPagination(total) {
    const totalPages = Math.ceil(total / state.pageSize);
    if (totalPages <= 1) {
      pagination.innerHTML = '<div class="text-muted text-center" style="font-size:12px">All entries shown</div>';
      return;
    }

    let html = '<ul class="pagination pagination-sm justify-content-center mb-0">';

    // Prev
    html += `<li class="page-item ${state.page <= 1 ? "disabled" : ""}">
      <a class="page-link" href="#" onclick="window.__goPage(${state.page - 1});return false;" aria-label="Previous">
        <span aria-hidden="true">&laquo;</span>
      </a>
    </li>`;

    const maxVisible = 5;
    let startPage = Math.max(1, state.page - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage + 1 < maxVisible) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }

    if (startPage > 1) {
      html += `<li class="page-item"><a class="page-link" href="#" onclick="window.__goPage(1);return false;">1</a></li>`;
      if (startPage > 2) html += '<li class="page-item disabled"><a class="page-link" href="#">&hellip;</a></li>';
    }

    for (let i = startPage; i <= endPage; i++) {
      html += `<li class="page-item ${i === state.page ? "active" : ""}">
        <a class="page-link" href="#" onclick="window.__goPage(${i});return false;">${i}</a>
      </li>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) html += '<li class="page-item disabled"><a class="page-link" href="#">&hellip;</a></li>';
      html += `<li class="page-item"><a class="page-link" href="#" onclick="window.__goPage(${totalPages});return false;">${totalPages}</a></li>`;
    }

    // Next
    html += `<li class="page-item ${state.page >= totalPages ? "disabled" : ""}">
      <a class="page-link" href="#" onclick="window.__goPage(${state.page + 1});return false;" aria-label="Next">
        <span aria-hidden="true">&raquo;</span>
      </a>
    </li>`;

    html += "</ul>";
    pagination.innerHTML = html;
  }

  function renderStats(stats) {
    // Animate counters
    const counters = [
      ["stat-total", stats.total_logs, ""],
      ["stat-time", stats.total_time_hours, "h"],
      ["stat-today", stats.today_time_hours, "h"],
      ["stat-week", stats.week_time_hours, "h"],
      ["stat-github", stats.github_logs, ""],
      ["stat-jira", stats.jira_logs, ""],
      ["stat-bitbucket", stats.bitbucket_logs, ""],
      ["stat-git", stats.git_logs, ""],
      ["stat-manual", stats.manual_logs, ""],
    ];

    counters.forEach(([id, value, suffix]) => {
      const val = parseInt(value) || 0;
      animateCounter(id, val, suffix);
    });

    // Sparklines
    if (stats.daily_counts && stats.daily_counts.length > 0) {
      renderSparkline("sparkline-total", stats.daily_counts, "#4F46E5");
    }

    // Trend
    if (stats.trend_percent !== undefined) {
      const trendEl = document.getElementById("stat-trend-total");
      if (trendEl) {
        trendEl.style.display = "inline-flex";
        const dir = stats.trend_percent >= 0 ? "up" : "down";
        trendEl.className = `stat-trend ${dir}`;
        trendEl.querySelector("span:last-child").textContent = Math.abs(stats.trend_percent) + "%";
      }
    }
  }

  // ─── Actions ───────────────────────────────────────

  async function loadData() {
    renderSkeleton();
    try {
      const [logsData, stats] = await Promise.all([fetchLogs(), fetchStats()]);
      renderTable(logsData);
      renderStats(stats);
    } catch (err) {
      console.error(err);
      showToast(`Error loading data: ${err.message}`, "error");
    }
  }

  function openModal(editData = null) {
    editingId = editData ? editData.id : null;
    document.getElementById("modal-title").textContent = editData ? "Edit Work Log" : "Add Manual Entry";

    if (editData) {
      document.getElementById("entry-title").value = editData.title || "";
      document.getElementById("entry-desc").value = editData.description || "";
      document.getElementById("entry-type").value = editData.activity_type || "other";
      document.getElementById("entry-project").value = editData.project || "";
      document.getElementById("entry-url").value = editData.url || "";
      document.getElementById("entry-date").value = editData.activity_timestamp
        ? new Date(editData.activity_timestamp).toISOString().slice(0, 16)
        : new Date().toISOString().slice(0, 16);
      document.getElementById("entry-hours").value = editData.time_spent_minutes ? Math.floor(editData.time_spent_minutes / 60) : 0;
      document.getElementById("entry-minutes").value = editData.time_spent_minutes ? editData.time_spent_minutes % 60 : 0;
    } else {
      manualForm.reset();
      document.getElementById("entry-date").value = new Date().toISOString().slice(0, 16);
      document.getElementById("entry-hours").value = 0;
      document.getElementById("entry-minutes").value = 0;
    }

    getManualModal().show();
  }

  function closeManualModal() {
    getManualModal().hide();
    editingId = null;
  }

  async function handleFormSubmit(e) {
    e.preventDefault();

    const data = {
      title: document.getElementById("entry-title").value.trim(),
      description: document.getElementById("entry-desc").value.trim() || null,
      activity_type: document.getElementById("entry-type").value,
      project: document.getElementById("entry-project").value.trim() || null,
      url: document.getElementById("entry-url").value.trim() || null,
      activity_timestamp: document.getElementById("entry-date").value
        ? new Date(document.getElementById("entry-date").value).toISOString()
        : null,
      time_spent_minutes:
        parseInt(document.getElementById("entry-hours").value || "0") * 60 +
        parseInt(document.getElementById("entry-minutes").value || "0"),
    };

    if (!data.title) {
      showToast("Title is required", "error");
      return;
    }

    await withButtonLoading(
      document.getElementById("btn-save"),
      "Saving...",
      async () => {
        if (editingId) {
          await updateLog(editingId, data);
          showToast("✅ Work log updated successfully!", "success");
        } else {
          await createLog(data);
          showToast("✅ Work log added successfully!", "success");
        }
        closeManualModal();
        loadData();
      }
    );
  }

  async function handleDelete(id) {
    if (!confirm("Delete this work log entry?")) return;
    await withLoading("Deleting...", async () => {
      await deleteLog(id);
      showToast("Work log deleted", "info");
      loadData();
    });
  }

  function handleEdit(id) {
    fetch(`/api/logs?page=1&page_size=200`)
      .then((r) => r.json())
      .then((data) => {
        const item = data.items.find((i) => i.id === id);
        if (item) openModal(item);
        else showToast("Work log not found", "error");
      })
      .catch((err) => showToast(`Error: ${err.message}`, "error"));
  }

  async function handleExport(source = "") {
    const url = source ? `/api/export/excel/${source}` : `/api/export/excel`;

    await withLoading("📥 Exporting Excel...", async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = source
        ? `worklog_${source}_${new Date().toISOString().slice(0, 10)}.xlsx`
        : `worklog_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
      showToast("✅ Excel exported successfully!", "success");
    });
  }

  // ─── Poll Now ──────────────────────────────────────

  async function triggerPoll() {
    // Find button — could be any .hero-btn with bi-arrow-repeat
    const btn = document.querySelector('.hero-btn .bi-arrow-repeat')?.closest('button')
             || document.querySelector('.topbar-btn .bi-arrow-repeat')?.closest('button');
    if (!btn) {
      // Just do silent poll without button feedback
      try {
        const res = await fetch("/api/poll", { method: "POST" });
        const data = await res.json();
        if (data.status === "ok") {
          showToast("🔄 Sync completed", "success");
        }
        await loadData();
      } catch (err) {
        showToast(`❌ Sync error: ${err.message}`, "error");
      }
      return;
    }

    const origHTML = btn.innerHTML;
    const origDisabled = btn.disabled;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>';

    try {
      const res = await fetch("/api/poll", { method: "POST" });
      const data = await res.json();
      if (data.status === "ok") {
        showToast("🔄 Sync completed — " + data.message, "success");
      } else {
        showToast("❌ Sync failed", "error");
      }
      await loadData();
    } catch (err) {
      showToast(`❌ Sync error: ${err.message}`, "error");
    } finally {
      btn.disabled = origDisabled;
      btn.innerHTML = origHTML;
    }
  }

  // ─── Filter handlers ───────────────────────────────

  function applyFilters() {
    state.source = filterSource.value;
    state.activityType = filterType.value;
    state.dateFrom = filterFrom.value ? new Date(filterFrom.value).toISOString() : "";
    state.dateTo = filterTo.value ? new Date(filterTo.value + "T23:59:59").toISOString() : "";
    state.search = filterSearch.value.trim();
    state.page = 1;
    loadData();
  }

  function handleSort(column) {
    if (state.sortBy === column) {
      state.sortOrder = state.sortOrder === "asc" ? "desc" : "asc";
    } else {
      state.sortBy = column;
      state.sortOrder = "desc";
    }
    loadData();
  }

  // ─── Modal helpers ─────────────────────────────────

  function openSettingsModal() {
    getSettingsModal().show();
    loadSettings();
  }

  function closeSettingsModal() {
    getSettingsModal().hide();
  }

  // ─── Export helper for cmd palette ─────────────────

  function exportNow() {
    handleExport("");
  }

  // ─── Window handlers (for inline onclick) ─────────

  // Dropdown action wrappers (called from table HTML)
  window.__deleteLog = handleDelete;
  window.__editLog = handleEdit;
  window.__classifySingle = handleClassifySingle;
  window.__enhanceSingle = handleEnhanceSingle;
  window.__goPage = (page) => {
    if (page < 1) return;
    state.page = page;
    loadData();
  };
  window.__refreshPage = () => {
    state.page = 1;
    loadData();
  };

  // Expose public names
  window.handleDelete = handleDelete;
  window.handleEdit = handleEdit;
  window.handleExport = handleExport;
  window.handleClassifySingle = handleClassifySingle;
  window.classifyUnclassified = classifyUnclassified;
  window.handleEnhanceSingle = handleEnhanceSingle;
  window.enhanceBatch = enhanceBatch;
  window.openManualModal = () => openModal();
  window.closeManualModal = closeManualModal;
  window.openSettingsModal = openSettingsModal;
  window.closeSettingsModal = closeSettingsModal;
  window.onProviderChange = onProviderChange;
  window.toggleApiKeyVisibility = toggleApiKeyVisibility;
  window.testAIConnection = testAIConnection;
  window.openSummaryPanel = openSummaryPanel;
  window.closeSummaryPanel = closeSummaryPanel;
  window.generateSummary = generateSummary;
  window.toggleChatPanel = toggleChatPanel;
  window.sendChatMessage = sendChatMessage;
  window.toggleAIPanel = toggleAIPanel;
  window.triggerPoll = triggerPoll;
  window.toggleSidebar = toggleSidebar;
  window.toggleTheme = toggleTheme;
  window.openCmdPalette = openCmdPalette;
  window.closeCmdPalette = closeCmdPalette;
  window.toggleFilterRow = toggleFilterRow;
  window.filterBySource = filterBySource;
  window.resetFilters = resetFilters;
  window.exportNow = exportNow;

  // ─── Init ──────────────────────────────────────────

  let _initialized = false;

  function init() {
    if (_initialized) return;
    _initialized = true;

    // Theme
    loadTheme();

    loadSettings();
    loadData();

    // Filter events
    filterSource.addEventListener("change", applyFilters);
    filterType.addEventListener("change", applyFilters);
    filterFrom.addEventListener("change", applyFilters);
    filterTo.addEventListener("change", applyFilters);

    let searchTimer;
    filterSearch.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilters, 400);
    });

    // Manual entry form
    const btnAddManual = document.querySelector("#btn-add-manual, #btn-add-manual-hero");
    if (btnAddManual) btnAddManual.addEventListener("click", () => openModal());
    const btnCancel = document.getElementById("btn-cancel");
    if (btnCancel) btnCancel.addEventListener("click", closeManualModal);
    manualForm.addEventListener("submit", handleFormSubmit);
    settingsForm.addEventListener("submit", handleSettingsSave);

    // Chat
    const chatInput = document.getElementById("chat-input");
    if (chatInput) {
      chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendChatMessage();
        }
      });
    }
    const chatSendBtn = document.getElementById("btn-chat-send");
    if (chatSendBtn) chatSendBtn.addEventListener("click", (e) => {
      e.preventDefault();
      sendChatMessage();
    });

    // Export buttons
    document.querySelectorAll(".hero-btn .bi-download").forEach((icon) => {
      icon.closest("button")?.addEventListener("click", () => handleExport(""));
    });

    // Sortable headers
    document.querySelectorAll("th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => handleSort(th.dataset.sort));
    });

    // ─── Keyboard Shortcuts ────────────────────────────
    document.addEventListener("keydown", (e) => {
      // ⌘K / Ctrl+K — command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const backdrop = $("#cmd-backdrop");
        if (backdrop && backdrop.classList.contains("active")) {
          closeCmdPalette();
        } else {
          openCmdPalette();
        }
      }
      // Escape — close command palette
      if (e.key === "Escape") {
        closeCmdPalette();
      }
      // ⌘N / Ctrl+N — new entry
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        openModal();
      }
      // ⌘E / Ctrl+E — export
      if ((e.metaKey || e.ctrlKey) && e.key === "e") {
        e.preventDefault();
        handleExport("");
      }
      // ⌘, / Ctrl+, — settings
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        openSettingsModal();
      }
    });

    // Command palette search (live filter)
    const cmdInput = document.getElementById("cmd-input");
    if (cmdInput) {
      cmdInput.addEventListener("input", function () {
        const q = this.value.toLowerCase();
        document.querySelectorAll(".cmd-modal-item").forEach((item) => {
          const text = item.textContent.toLowerCase();
          item.style.display = text.includes(q) ? "flex" : "none";
        });
      });
      cmdInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const visible = document.querySelector('.cmd-modal-item:not([style*="display: none"])');
          if (visible) visible.click();
        }
      });
    }

    // Auto-refresh
    setInterval(loadData, 30000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

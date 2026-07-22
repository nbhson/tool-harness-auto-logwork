/**
 * Work Log Harness — Frontend
 *
 * SPA với:
 * - Bảng work logs (filter, sort, paginate)
 * - Modal manual entry
 * - Export Excel
 * - ⚙️ AI Settings (provider, key, model)
 * - ✨ Auto-classify, 📊 Summary, 💬 Chat
 * - Auto-refresh
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
  };

  let editingId = null;

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

  const modalOverlay = $("#modal-overlay");
  const modalTitle = $("#modal-title");
  const manualForm = $("#manual-form");
  const btnAddManual = $("#btn-add-manual");
  const btnCancel = $("#btn-cancel");
  const btnExport = $("#btn-export");

  const settingsOverlay = $("#settings-modal-overlay");
  const settingsForm = $("#settings-form");

  const aiToolbar = $("#ai-toolbar");
  const aiBadge = $("#ai-enabled-badge");
  const summaryPanel = $("#summary-panel");
  const chatPanel = $("#chat-panel");

  // ─── Helpers ───────────────────────────────────────

  function showToast(message, type = "info") {
    const container = $("#toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.3s";
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

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
    return `badge badge-${source}`;
  }

  function activityTypeLabel(type) {
    const labels = {
      ticket_update: "Update",
      comment: "Comment",
      estimation_change: "Estimation",
      status_change: "Status",
      worklog: "Worklog",
      commit: "Commit",
      push: "Push",
      pr_create: "PR Create",
      pr_merge: "PR Merge",
      pr_comment: "PR Comment",
      local_commit: "Local Commit",
      meeting: "Meeting",
      code_review: "Code Review",
      research: "Research",
      other: "Other",
    };
    return labels[type] || type;
  }

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
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
      key_hint: "Get key at platform.openai.com/api-keys",
      model_hint: "Models: gpt-4o, gpt-4o-mini, gpt-4-turbo",
    },
    gemini: {
      base_url: "https://generativelanguage.googleapis.com/v1beta/openai/",
      model: "gemini-2.0-flash",
      key_hint: "Get free API key at aistudio.google.com/apikey",
      model_hint: "Models: gemini-2.0-flash, gemini-2.5-pro, gemini-1.5-pro",
    },
    anthropic: {
      base_url: "https://api.anthropic.com/v1",
      model: "claude-sonnet-4-20250514",
      key_hint: "Get key at console.anthropic.com",
      model_hint: "Models: claude-sonnet-4-20250514, claude-3-5-sonnet-20241022",
    },
    openrouter: {
      base_url: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o",
      key_hint: "Get key at openrouter.ai/keys",
      model_hint: "Thousands of models available",
    },
    deepseek: {
      base_url: "https://api.deepseek.com",
      model: "deepseek-chat",
      key_hint: "Get key at platform.deepseek.com",
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

    // Only auto-fill if fields are empty or user hasn't customized
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
    if (hint && preset.key_hint) {
      hint.innerHTML = preset.key_hint;
    }

    const modelHint = document.getElementById("ai-model-hint");
    if (modelHint && preset.model_hint) {
      modelHint.textContent = preset.model_hint;
    }
  }

  function toggleApiKeyVisibility() {
    const keyField = document.getElementById("setting-ai-api-key");
    const btn = document.getElementById("btn-toggle-key");
    if (keyField.type === "password") {
      keyField.type = "text";
      btn.textContent = "🙈";
    } else {
      keyField.type = "password";
      btn.textContent = "👁️";
    }
  }

  async function loadSettings() {
    try {
      const data = await fetchSettings();
      const s = data.settings || {};

      // Populate form
      document.getElementById("setting-ai-enabled").value =
        s.ai_enabled || "false";
      document.getElementById("setting-ai-provider").value =
        s.ai_provider || "openai";
      document.getElementById("setting-ai-api-key").value =
        s.ai_api_key || "";
      document.getElementById("setting-ai-base-url").value =
        s.ai_base_url || "";
      document.getElementById("setting-ai-model").value =
        s.ai_model || "";

      // Update hints
      onProviderChange();

      // Update UI state
      state.aiEnabled = s.ai_enabled === "true" && !!s.ai_api_key;
      updateAIUI();
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  }

  function updateAIUI() {
    if (state.aiEnabled) {
      aiToolbar.style.display = "flex";
      aiBadge.style.display = "inline-block";
    } else {
      aiToolbar.style.display = "none";
      aiBadge.style.display = "none";
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

    try {
      await saveSettings(items);
      showToast("✅ AI settings saved!", "success");
      closeSettingsModal();
      await loadSettings();
    } catch (err) {
      showToast(`Error: ${err.message}`, "error");
    }
  }

  async function testAIConnection() {
    const btn = document.getElementById("btn-test-ai");
    const result = document.getElementById("ai-test-result");
    const modelStatus = document.getElementById("model-load-status");
    btn.disabled = true;
    btn.textContent = "⏳ Testing...";
    result.textContent = "";
    result.style.color = "var(--text-secondary)";
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
      btn.textContent = "🔌 Test Connection & Load Models";
      return;
    }

    try {
      const res = await testConnection(data);
      if (res.status === "success") {
        // Build status message — chat test optional, models list is the key
        const connMsg = res.models && res.models.length > 0
          ? `✅ Connected! Found ${res.models.length} models`
          : `✅ Connected!${res.response ? ` Response: "${res.response}"` : ""}`;
        result.textContent = connMsg;
        result.style.color = "#28a745";

        // Populate model dropdown if available
        if (res.models && res.models.length > 0) {
          populateModelDropdown(res.models, res.suggested_model);
          if (modelStatus) {
            modelStatus.textContent = `✅ Loaded ${res.models.length} models`;
            modelStatus.style.color = "#28a745";
          }
        } else {
          if (modelStatus) {
            modelStatus.textContent = "ℹ️ No models list available. You can type the model name manually.";
            modelStatus.style.color = "var(--text-secondary)";
          }
        }
      } else {
        result.textContent = `❌ ${res.message || "Connection failed"}`;
        result.style.color = "#dc3545";
        // On failure, keep text input
        restoreModelInput();
      }
    } catch (err) {
      result.textContent = `❌ ${err.message}`;
      result.style.color = "#dc3545";
      restoreModelInput();
    }

    btn.disabled = false;
    btn.textContent = "🔌 Test Connection & Load Models";
  }

  function populateModelDropdown(models, suggested) {
    const wrapper = document.getElementById("model-input-wrapper");
    const currentVal = document.getElementById("setting-ai-model").value;

    // Replace text input with select dropdown
    let html = '<select class="form-control" id="setting-ai-model">';
    let hasMatch = false;
    for (const m of models) {
      const selected =
        m.id === suggested || m.id === currentVal ? "selected" : "";
      if (selected) hasMatch = true;
      const label = m.owned_by ? `${m.id} (${m.owned_by})` : m.id;
      html += `<option value="${m.id}" ${selected}>${label}</option>`;
    }
    // Add custom option
    html += `<option value="__custom__">✦ Custom model...</option>`;
    html += "</select>";

    wrapper.innerHTML = html;

    // Handle "Custom model..." selection
    const select = document.getElementById("setting-ai-model");
    select.addEventListener("change", function () {
      if (this.value === "__custom__") {
        const manual = prompt("Enter model name:");
        if (manual) {
          // Add the custom option and select it
          const opt = document.createElement("option");
          opt.value = manual;
          opt.textContent = `✦ ${manual}`;
          opt.selected = true;
          this.insertBefore(opt, this.querySelector('[value="__custom__"]'));
        } else {
          // Revert to first option
          this.selectedIndex = 0;
        }
      }
    });

    // Update model hint
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
    try {
      const result = await classifyLog(logId);
      showToast(
        `✨ Classified: "${result.category}" (${result.confidence * 100}% confidence)`,
        "success"
      );
      loadData();
    } catch (err) {
      showToast(`Error: ${err.message}`, "error");
    }
  }

  async function classifyUnclassified() {
    const btn = document.getElementById("btn-ai-classify");
    btn.disabled = true;
    btn.textContent = "⏳ Classifying...";

    try {
      const result = await classifyBatch();
      const count = result.results ? result.results.length : 0;
      const highConf = result.results
        ? result.results.filter((r) => r.confidence > 0.5).length
        : 0;
      showToast(
        `✨ Classified ${count} entries (${highConf} with high confidence)`,
        "success"
      );
      loadData();
    } catch (err) {
      showToast(`Error: ${err.message}`, "error");
    }

    btn.disabled = false;
    btn.textContent = "✨ Auto-Classify";
  }

  // ─── AI Enhance ──────────────────────────────────────

  async function handleEnhanceSingle(logId) {
    if (!confirm("🪄 AI Enhance this entry? (rewrite description + estimate time)")) return;
    try {
      const res = await fetch(`/api/ai/enhance/${logId}`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).detail || "Enhance failed");
      await loadData();
      showToast("✅ Entry enhanced!", "success");
    } catch (err) {
      showToast(`❌ ${err.message}`, "error");
    }
  }

  async function enhanceBatch() {
    const btn = document.getElementById("btn-ai-classify");
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = "⏳ Enhancing...";
    try {
      const res = await fetch("/api/ai/enhance", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).detail || "Enhance failed");
      await loadData();
      showToast("✅ Batch enhance complete!", "success");
    } catch (err) {
      showToast(`❌ ${err.message}`, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "🪄 Auto-Enhance";
    }
  }

  function openSummaryPanel() {
    summaryPanel.style.display = "block";
    // Set default date range
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    document.getElementById("summary-from").value = weekAgo;
    document.getElementById("summary-to").value = today;
    document.getElementById("summary-result").innerHTML =
      '<div class="summary-placeholder">Click Generate to create AI summary.</div>';
    summaryPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeSummaryPanel() {
    summaryPanel.style.display = "none";
  }

  async function generateSummary() {
    const resultDiv = document.getElementById("summary-result");
    resultDiv.innerHTML = '<div class="spinner"></div> Generating...';

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
    msg.textContent = content;
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

  function renderTable(data) {
    const { items, total, page } = data;
    state.total = total;

    if (!items || items.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="8">
            <div class="empty-state">
              <div class="empty-icon">📋</div>
              <h3>No work logs yet</h3>
              <p>Configure Jira/Bitbucket in .env or add manual entries.</p>
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
        <td><span class="${badgeClass(log.source)}">${log.source}</span></td>
        <td><span class="activity-badge">${activityTypeLabel(log.activity_type)}</span></td>
        <td class="cell-title">
          ${log.url ? `<a href="${log.url}" target="_blank">${escapeHtml(log.title)}</a>` : escapeHtml(log.title)}
          ${log.description ? `<div class="cell-desc" title="${escapeHtml(log.description)}">${escapeHtml(log.description)}</div>` : ""}
        </td>
        <td>${escapeHtml(log.project || "-")}</td>
        <td class="cell-date">${formatDate(log.activity_timestamp)}</td>
        <td class="cell-time">${formatTime(log.time_spent_minutes)}</td>
        <td>${log.external_id ? `<code style="font-size:11px;color:var(--text-secondary)">${escapeHtml(log.external_id.substring(0, 30))}</code>` : "-"}</td>
        <td class="cell-actions">
          ${state.aiEnabled ? `<button class="btn btn-sm btn-ai" onclick="handleClassifySingle(${log.id})" title="AI Classify">✨</button>
          <button class="btn btn-sm btn-ai" onclick="handleEnhanceSingle(${log.id})" title="AI Enhance">🪄</button>` : ""}
          <button class="btn btn-sm btn-outline" onclick="handleEdit(${log.id})" title="Edit">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="handleDelete(${log.id})" title="Delete">🗑️</button>
        </td>
      </tr>`
      )
      .join("");

    const start = (page - 1) * state.pageSize + 1;
    const end = Math.min(page * state.pageSize, total);
    tableInfo.textContent = `Showing ${start}-${end} of ${total} entries`;

    renderPagination(total);
  }

  function renderPagination(total) {
    const totalPages = Math.ceil(total / state.pageSize);
    if (totalPages <= 1) {
      pagination.innerHTML = "";
      return;
    }

    let html = `<button onclick="window.__goPage(${state.page - 1})" ${state.page <= 1 ? "disabled" : ""}>‹ Prev</button>`;

    const maxVisible = 5;
    let startPage = Math.max(1, state.page - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage + 1 < maxVisible) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }

    if (startPage > 1) {
      html += `<button onclick="window.__goPage(1)">1</button>`;
      if (startPage > 2) html += `<span style="padding:4px 6px">…</span>`;
    }

    for (let i = startPage; i <= endPage; i++) {
      html += `<button onclick="window.__goPage(${i})" class="${i === state.page ? "active" : ""}">${i}</button>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) html += `<span style="padding:4px 6px">…</span>`;
      html += `<button onclick="window.__goPage(${totalPages})">${totalPages}</button>`;
    }

    html += `<button onclick="window.__goPage(${state.page + 1})" ${state.page >= totalPages ? "disabled" : ""}>Next ›</button>`;
    pagination.innerHTML = html;
  }

  function renderStats(stats) {
    document.getElementById("stat-total").textContent = stats.total_logs;
    document.getElementById("stat-time").textContent = `${stats.total_time_hours}h`;
    document.getElementById("stat-today").textContent = `${stats.today_time_hours}h`;
    document.getElementById("stat-week").textContent = `${stats.week_time_hours}h`;
    document.getElementById("stat-jira").textContent = stats.jira_logs;
    document.getElementById("stat-bitbucket").textContent = stats.bitbucket_logs;
    document.getElementById("stat-github").textContent = stats.github_logs;
    document.getElementById("stat-git").textContent = stats.git_logs;
    document.getElementById("stat-manual").textContent = stats.manual_logs;
  }

  // ─── Actions ───────────────────────────────────────

  async function loadData() {
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
    modalTitle.textContent = editData ? "Edit Work Log" : "Add Manual Entry";

    if (editData) {
      document.getElementById("entry-title").value = editData.title || "";
      document.getElementById("entry-desc").value = editData.description || "";
      document.getElementById("entry-type").value = editData.activity_type || "other";
      document.getElementById("entry-project").value = editData.project || "";
      document.getElementById("entry-url").value = editData.url || "";
      document.getElementById("entry-date").value = editData.activity_timestamp
        ? new Date(editData.activity_timestamp).toISOString().slice(0, 16)
        : new Date().toISOString().slice(0, 16);
      document.getElementById("entry-hours").value =
        editData.time_spent_minutes ? Math.floor(editData.time_spent_minutes / 60) : 0;
      document.getElementById("entry-minutes").value =
        editData.time_spent_minutes ? editData.time_spent_minutes % 60 : 0;
    } else {
      manualForm.reset();
      document.getElementById("entry-date").value = new Date().toISOString().slice(0, 16);
      document.getElementById("entry-hours").value = 0;
      document.getElementById("entry-minutes").value = 0;
    }

    modalOverlay.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function closeManualModal() {
    modalOverlay.classList.remove("active");
    document.body.style.overflow = "";
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

    try {
      if (editingId) {
        await updateLog(editingId, data);
        showToast("Work log updated successfully!", "success");
      } else {
        await createLog(data);
        showToast("Work log added successfully!", "success");
      }
      closeManualModal();
      loadData();
    } catch (err) {
      showToast(`Error: ${err.message}`, "error");
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this work log entry?")) return;
    try {
      await deleteLog(id);
      showToast("Work log deleted", "info");
      loadData();
    } catch (err) {
      showToast(`Error: ${err.message}`, "error");
    }
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
    const url = source
      ? `/api/export/excel/${source}`
      : `/api/export/excel`;

    try {
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
      showToast("Excel exported successfully!", "success");
    } catch (err) {
      showToast(`Export error: ${err.message}`, "error");
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
    settingsOverlay.classList.add("active");
    document.body.style.overflow = "hidden";
    loadSettings();
  }

  function closeSettingsModal() {
    settingsOverlay.classList.remove("active");
    document.body.style.overflow = "";
  }

  // ─── Expose globals (for onclick) ──────────────────

  window.__goPage = (page) => {
    if (page < 1) return;
    state.page = page;
    loadData();
  };

  window.__refreshPage = () => {
    state.page = 1;
    loadData();
  };

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

  // ─── Init ──────────────────────────────────────────

  let _initialized = false;

  function init() {
    if (_initialized) return;
    _initialized = true;
    // Load settings first (to show/hide AI toolbar)
    loadSettings();

    // Load data
    loadData();

    // Event listeners
    filterSource.addEventListener("change", applyFilters);
    filterType.addEventListener("change", applyFilters);
    filterFrom.addEventListener("change", applyFilters);
    filterTo.addEventListener("change", applyFilters);

    let searchTimer;
    filterSearch.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilters, 400);
    });

    btnAddManual.addEventListener("click", () => openModal());

    btnCancel.addEventListener("click", closeManualModal);

    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) closeManualModal();
    });

    settingsOverlay.addEventListener("click", (e) => {
      if (e.target === settingsOverlay) closeSettingsModal();
    });

    manualForm.addEventListener("submit", handleFormSubmit);
    settingsForm.addEventListener("submit", handleSettingsSave);

    // Chat: Enter to send + button click
    document.getElementById("chat-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
    document.getElementById("btn-chat-send").addEventListener("click", (e) => {
      e.preventDefault();
      sendChatMessage();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeManualModal();
        closeSettingsModal();
      }
    });

    // Export buttons
    btnExport.addEventListener("click", () => handleExport(""));

    document.querySelectorAll("[data-export-source]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const source = btn.dataset.exportSource;
        handleExport(source);
      });
    });

    // Sortable headers
    document.querySelectorAll("th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => handleSort(th.dataset.sort));
    });

    // Auto-refresh every 30 seconds
    setInterval(loadData, 30000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

const AUTO_LOOP_MAX_ATTEMPTS = 5;
const RUN_STATE_POLL_MS = 1500;

const state = {
  pipelines: {},
  activePipelineKey: "startup",
  prompts: {},
  stages: {},
  stageOrder: [],
  gateVerdicts: {},
  stageLocks: {},
  defaultStageKey: "generateIdeas",
  activeStageKey: null,
  running: false,
  lastExitCode: null,
  runId: null,
  lastEventSeq: 0,
  pollTimer: null,
  currentRun: null,
  observedActiveRunId: null,
  notifiedRunId: null
};

const pipelineInput = document.getElementById("pipelineInput");
const cwdInput = document.getElementById("cwdInput");
const providerInput = document.getElementById("providerInput");
const modelInput = document.getElementById("modelInput");
const searchInput = document.getElementById("searchInput");
const promptInput = document.getElementById("promptInput");
const output = document.getElementById("output");
const runButton = document.getElementById("runButton");
const stopButton = document.getElementById("stopButton");
const statusPill = document.getElementById("statusPill");
const statusDetail = document.getElementById("statusDetail");
const seedButton = document.getElementById("seedButton");
const stageMeta = document.getElementById("stageMeta");
const stageButtons = document.getElementById("stageButtons");
const overrideGateButton = document.getElementById("overrideGateButton");

function setStatus(text, cls) {
  statusPill.textContent = text;
  statusPill.className = `status ${cls}`;
}

function setStatusDetail(text = "") {
  if (!statusDetail) return;
  statusDetail.textContent = text;
}

function getStage(stageKey) {
  return stageKey ? state.stages[stageKey] || null : null;
}

function getStagePrompt(stageKey) {
  const stage = getStage(stageKey);
  return stage?.prompt || state.prompts[stageKey] || "";
}

function getStageOutputFile(stageKey) {
  const outputs = getStage(stageKey)?.outputs;
  return Array.isArray(outputs) && outputs.length > 0 ? outputs[0] : "";
}

function getStageKeyByGateFile(gateFile) {
  for (const key of state.stageOrder) {
    if (getStageOutputFile(key) === gateFile) return key;
  }
  return null;
}

function getOverrideTarget(stageKey = state.activeStageKey) {
  const stage = getStage(stageKey);
  if (!stage) return null;

  if (stage.isGate) {
    const gateFile = getStageOutputFile(stageKey);
    return gateFile
      ? {
          gateStageKey: stageKey,
          gateFile,
          verdict: state.gateVerdicts[gateFile] || "missing"
        }
      : null;
  }

  if (stage.gateStageKey) {
    const gateFile = getStageOutputFile(stage.gateStageKey);
    return gateFile
      ? {
          gateStageKey: stage.gateStageKey,
          gateFile,
          verdict: state.gateVerdicts[gateFile] || "missing"
        }
      : null;
  }

  const lock = state.stageLocks[stageKey];
  if (lock?.locked && Array.isArray(lock.blocking) && lock.blocking.length === 1) {
    const gateFile = lock.blocking[0];
    return {
      gateStageKey: getStageKeyByGateFile(gateFile),
      gateFile,
      verdict: state.gateVerdicts[gateFile] || "missing"
    };
  }

  return null;
}

function clearOutput() {
  output.innerHTML = "";
}

function scrollOutput() {
  output.scrollTop = output.scrollHeight;
}

function createCard(kind, title, body, meta = "") {
  const card = document.createElement("article");
  card.className = `output-card ${kind}`;

  const header = document.createElement("div");
  header.className = "output-card-header";

  const titleEl = document.createElement("div");
  titleEl.className = "output-card-title";
  titleEl.textContent = title;
  header.appendChild(titleEl);

  if (meta) {
    const metaEl = document.createElement("div");
    metaEl.className = "output-card-meta";
    metaEl.textContent = meta;
    header.appendChild(metaEl);
  }

  card.appendChild(header);

  if (body) {
    const bodyEl = document.createElement(
      kind === "agent" || kind === "info" || kind === "success" || kind === "error"
        ? "div"
        : "pre"
    );
    bodyEl.className = "output-card-body";
    bodyEl.textContent = body;
    card.appendChild(bodyEl);
  }

  output.appendChild(card);
  scrollOutput();
  return card;
}

function createEventRow(kind, label, value = "") {
  const row = document.createElement("div");
  row.className = `output-row ${kind}`;

  const labelEl = document.createElement("div");
  labelEl.className = "output-row-label";
  labelEl.textContent = label;
  row.appendChild(labelEl);

  if (value) {
    const valueEl = document.createElement("div");
    valueEl.className = "output-row-value";
    valueEl.textContent = value;
    row.appendChild(valueEl);
  }

  output.appendChild(row);
  scrollOutput();
  return row;
}

function appendSummaryRow(label, value) {
  const row = document.createElement("div");
  row.className = "output-summary-row";

  const labelEl = document.createElement("span");
  labelEl.className = "output-summary-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("span");
  valueEl.className = "output-summary-value";
  valueEl.textContent = value;

  row.append(labelEl, valueEl);
  return row;
}

function createRunSummaryFromRun(run) {
  if (!run?.runId) return;

  const stage = getStage(run.stageKey);
  const promptPreview = String(run.prompt || "").replace(/\s+/g, " ").trim();

  const card = document.createElement("section");
  card.className = "run-summary";

  const header = document.createElement("div");
  header.className = "run-summary-header";

  const title = document.createElement("strong");
  title.className = "run-summary-title";
  title.textContent = run.stageTitle || stage?.title || "Custom Run";
  header.appendChild(title);

  const pill = document.createElement("span");
  const isGate = stage?.isGate || run.mode === "gate-auto-loop";
  pill.className = `run-summary-pill${isGate ? " gate" : ""}`;
  if (run.mode === "build-auto-loop" || run.mode === "gate-auto-loop") {
    pill.textContent = `Auto loop x${run.maxAttempts || AUTO_LOOP_MAX_ATTEMPTS}`;
  } else if (isGate) {
    pill.textContent = "Hard gate";
  } else {
    pill.textContent = run.search ? "Web search on" : "Web search off";
  }
  header.appendChild(pill);

  const grid = document.createElement("div");
  grid.className = "run-summary-grid";
  grid.append(
    appendSummaryRow("Provider", (run.provider || "codex").charAt(0).toUpperCase() + (run.provider || "codex").slice(1)),
    appendSummaryRow("Workspace", run.cwd || cwdInput.value),
    appendSummaryRow("Model", run.model || "Default"),
    appendSummaryRow("Outputs", Array.isArray(stage?.outputs) ? stage.outputs.join(", ") : "Workspace files")
  );

  const preview = document.createElement("div");
  preview.className = "run-summary-preview";
  preview.textContent = promptPreview.length > 240 ? `${promptPreview.slice(0, 240)}...` : promptPreview;

  card.append(header, grid, preview);
  output.appendChild(card);
  scrollOutput();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function updateRunButtonLabel() {
  const provider = providerInput ? providerInput.value : "codex";
  const label = provider === "claude" ? "Run With Claude" : "Run With Codex";
  runButton.textContent = label;
}

function updateSearchVisibility() {
  const provider = providerInput ? providerInput.value : "codex";
  const searchField = searchInput ? searchInput.closest("label.checkbox") : null;
  if (searchField) {
    searchField.style.display = provider === "claude" ? "none" : "";
  }
}

function applyRunningState(running) {
  state.running = running;
  runButton.disabled = running;
  stopButton.disabled = false;
  renderStageButtons();
  updateOverrideButton();
}

function browserNotificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

async function requestBrowserNotificationPermission() {
  if (!browserNotificationsSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission !== "default") return false;

  try {
    const permission = await Notification.requestPermission();
    return permission === "granted";
  } catch {
    return false;
  }
}

function notifyRunFinished(run) {
  if (!browserNotificationsSupported() || Notification.permission !== "granted") return;
  if (!run?.runId || state.notifiedRunId === run.runId) return;
  if (state.observedActiveRunId !== run.runId) return;
  if (run.status !== "completed" && run.status !== "failed") return;

  state.notifiedRunId = run.runId;

  const succeeded = run.status === "completed";
  const notification = new Notification(succeeded ? "Foundry run complete" : "Foundry run failed", {
    body: `${run.stageTitle || "Run"} ${succeeded ? "completed" : "stopped"}.`,
    tag: run.runId,
    renotify: false
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}

function updateStatusFromRun(run) {
  state.currentRun = run || null;
  state.lastExitCode = typeof run?.lastExitCode === "number" ? run.lastExitCode : null;
  applyRunningState(Boolean(run?.active));

  if (!run?.runId) {
    setStatus("Idle", "idle");
    setStatusDetail("");
    return;
  }

  if (run.active) {
    state.observedActiveRunId = run.runId;
    setStatus("Running", "running");
    const details = [
      run.currentStageTitle || run.stageTitle || "Run active",
      run.currentLabel || "",
      run.attempt ? `attempt ${run.attempt}/${run.maxAttempts || AUTO_LOOP_MAX_ATTEMPTS}` : ""
    ].filter(Boolean);
    setStatusDetail(details.join(" | "));
    return;
  }

  if (run.status === "completed") {
    setStatus("Done", "done");
    setStatusDetail(`${run.stageTitle || "Run"} complete`);
    notifyRunFinished(run);
    return;
  }

  if (run.status === "failed") {
    setStatus("Failed", "failed");
    setStatusDetail(`${run.stageTitle || "Run"} stopped`);
    notifyRunFinished(run);
    return;
  }

  setStatus("Idle", "idle");
  setStatusDetail("");
}

function renderStageMeta(stage) {
  if (!stageMeta) return;
  if (!stage) {
    stageMeta.innerHTML = "";
    updateOverrideButton();
    return;
  }

  const inputs = Array.isArray(stage.inputs) ? stage.inputs.join(", ") : "";
  const outputs = Array.isArray(stage.outputs) ? stage.outputs.join(", ") : "";
  const skills = Array.isArray(stage.skills) ? stage.skills.join(", ") : "";
  const searchLabel = stage.recommendedSearch ? "Research-heavy" : "Mostly local";
  const gateLabel = stage.isGate ? "Quality gate" : "Build stage";
  const lock = state.stageLocks[state.activeStageKey] || { locked: false, blocking: [] };
  const prerequisites = Array.isArray(stage.requiresPassGates) ? stage.requiresPassGates.join(", ") : "";
  const autoLoopLabel = stage.isGate && Array.isArray(stage.repairStageKeys) && stage.repairStageKeys.length > 0
    ? `Auto-repair loop up to ${AUTO_LOOP_MAX_ATTEMPTS} attempts`
    : (stage.gateStageKey ? `Auto-gates and retries up to ${AUTO_LOOP_MAX_ATTEMPTS} attempts` : "Single run");

  stageMeta.innerHTML = `
    <div class="stage-meta-header">
      <div>
        <strong>${escapeHtml(stage.title || "Stage")}</strong>
        <p class="stage-meta-summary">${escapeHtml(stage.summary || "")}</p>
      </div>
      <div class="stage-meta-pill-row">
        <span class="stage-meta-pill">${escapeHtml(searchLabel)}</span>
        <span class="stage-meta-pill ${stage.isGate ? "gate" : ""}">${escapeHtml(gateLabel)}</span>
      </div>
    </div>
    <div class="stage-meta-grid">
      <div class="stage-meta-row">
        <span class="stage-meta-label">Inputs</span>
        <span class="stage-meta-value">${escapeHtml(inputs || "Workspace files")}</span>
      </div>
      <div class="stage-meta-row">
        <span class="stage-meta-label">Outputs</span>
        <span class="stage-meta-value">${escapeHtml(outputs || "Workspace files")}</span>
      </div>
      <div class="stage-meta-row">
        <span class="stage-meta-label">Skills</span>
        <span class="stage-meta-value">${escapeHtml(skills || "Prompt-only stage")}</span>
      </div>
      <div class="stage-meta-row">
        <span class="stage-meta-label">Delegation</span>
        <span class="stage-meta-value">${escapeHtml(stage.delegation?.[0] || "No explicit delegation guidance.")}</span>
      </div>
      <div class="stage-meta-row">
        <span class="stage-meta-label">Gate Prerequisites</span>
        <span class="stage-meta-value">${escapeHtml(prerequisites || "None")}</span>
      </div>
      <div class="stage-meta-row">
        <span class="stage-meta-label">Current Status</span>
        <span class="stage-meta-value">${escapeHtml(lock.locked ? `Blocked by: ${lock.blocking.join(", ")}` : "Ready to run")}</span>
      </div>
      <div class="stage-meta-row">
        <span class="stage-meta-label">Run Mode</span>
        <span class="stage-meta-value">${escapeHtml(autoLoopLabel)}</span>
      </div>
    </div>
  `;
  updateOverrideButton();
}

function updateOverrideButton() {
  if (!overrideGateButton) return;

  const target = getOverrideTarget();
  if (!target || target.verdict === "pass" || target.verdict === "missing") {
    overrideGateButton.hidden = true;
    overrideGateButton.disabled = true;
    overrideGateButton.textContent = "Override Gate";
    overrideGateButton.removeAttribute("title");
    return;
  }

  const gateStage = getStage(target.gateStageKey);
  overrideGateButton.hidden = false;
  overrideGateButton.disabled = state.running;
  overrideGateButton.textContent = `Override ${gateStage?.buttonLabel || gateStage?.title || "Gate"}`;
  overrideGateButton.title = `Mark ${target.gateFile} as PASS and unlock downstream stages with a manual audit reason.`;
}

function renderStageButtons() {
  if (!stageButtons) return;

  const groups = [];
  const groupLookup = new Map();

  for (const key of state.stageOrder) {
    const stage = state.stages[key];
    if (!stage) continue;
    const groupName = stage.group || "Other";
    let group = groupLookup.get(groupName);
    if (!group) {
      group = { name: groupName, items: [] };
      groupLookup.set(groupName, group);
      groups.push(group);
    }
    group.items.push({ key, stage });
  }

  stageButtons.innerHTML = "";

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "stage-group";

    const title = document.createElement("div");
    title.className = "stage-group-title";
    title.textContent = group.name;
    section.appendChild(title);

    const list = document.createElement("div");
    list.className = "stage-group-buttons";

    for (const item of group.items) {
      const lock = state.stageLocks[item.key] || { locked: false, blocking: [] };
      const gateFile = item.stage.outputs?.[0] || "";
      const verdict = gateFile ? state.gateVerdicts[gateFile] : "";
      const button = document.createElement("button");
      button.type = "button";
      button.className = `stage-button${item.key === state.activeStageKey ? " active" : ""}${item.stage.isGate ? " gate" : ""}${lock.locked ? " locked" : ""}`;
      button.dataset.stageKey = item.key;
      button.disabled = state.running || lock.locked;

      const label = document.createElement("span");
      label.className = "stage-button-label";
      label.textContent = item.stage.buttonLabel || item.stage.title || item.key;
      button.appendChild(label);

      const detail = document.createElement("span");
      detail.className = "stage-button-detail";
      if (item.stage.isGate) {
        detail.textContent = verdict ? `Verdict: ${verdict.toUpperCase()}` : "Pass or fail review";
      } else if (lock.locked) {
        detail.textContent = `Blocked by ${lock.blocking.join(", ")}`;
      } else {
        detail.textContent = item.stage.outputs?.[0] || "Workspace output";
      }
      button.appendChild(detail);

      list.appendChild(button);
    }

    section.appendChild(list);
    stageButtons.appendChild(section);
  }
}

function applyStage(stageKey) {
  const stage = getStage(stageKey);
  if (!stage) return;
  state.activeStageKey = stageKey;
  promptInput.value = getStagePrompt(stageKey);
  searchInput.checked = stage.recommendedSearch !== false;
  renderStageButtons();
  renderStageMeta(stage);
}

function refreshWorkspaceStateFromPayload(workspaceState) {
  state.gateVerdicts = workspaceState?.gateVerdicts || {};
  state.stageLocks = workspaceState?.stageLocks || {};
  renderStageButtons();
  if (state.activeStageKey) {
    renderStageMeta(getStage(state.activeStageKey));
  } else {
    updateOverrideButton();
  }
}

function kindLabel(kind) {
  return String(kind || "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function describeFileChanges(changes = []) {
  if (!Array.isArray(changes) || changes.length === 0) return "";
  return changes
    .map((change) => {
      const filePath = change.path || "Unknown file";
      const changeKind = change.kind ? kindLabel(change.kind) : "Updated";
      return `${changeKind}: ${filePath}`;
    })
    .join("\n");
}

function summarizeItem(item = {}) {
  if (typeof item.text === "string" && item.text.trim()) return item.text.trim();
  if (typeof item.command === "string" && item.command.trim()) return item.command.trim();
  if (Array.isArray(item.command) && item.command.length > 0) return item.command.join(" ");
  if (typeof item.stderr === "string" && item.stderr.trim()) return item.stderr.trim();
  if (typeof item.path === "string" && item.path.trim()) return item.path.trim();
  if (typeof item.title === "string" && item.title.trim()) return item.title.trim();
  if (item.changes) return describeFileChanges(item.changes);
  return JSON.stringify(item, null, 2);
}

function summarizePreview(text, limit = 240) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function renderToolEvent(e) {
  const item = e.item || {};
  const status = item.status ? kindLabel(item.status) : "";

  if (item.type === "file_change") {
    const label = e.type === "item.started" ? "File Change" : "File Updated";
    createEventRow("file", status ? `${label} | ${status}` : label, describeFileChanges(item.changes));
    return;
  }

  if (item.type === "command_execution") {
    const preview = summarizePreview(summarizeItem(item));
    createEventRow("tool", status ? `Command Execution | ${status}` : "Command Execution", preview);
    return;
  }

  const title = item.type ? kindLabel(item.type) : kindLabel(e.type);
  const preview = summarizePreview(summarizeItem(item));
  createEventRow("tool", status ? `${title} | ${status}` : title, preview);
}

function renderEvent(evt) {
  if (evt.type === "note") {
    if (evt.kind === "success" || evt.kind === "error") {
      createCard(evt.kind, evt.label, evt.message);
      return;
    }
    createEventRow(evt.kind || "info", evt.label, evt.message);
    return;
  }

  if (evt.type === "meta") {
    const cmdName = evt.command || "codex";
    createEventRow("command", "Command", summarizePreview(`${cmdName} ${evt.args.join(" ")}`, 340));
    return;
  }

  if (evt.type === "stderr") {
    createEventRow("stderr", "Stderr", summarizePreview(evt.line, 320));
    return;
  }

  if (evt.type === "stdout") {
    createEventRow("stdout", "Stdout", summarizePreview(evt.line, 320));
    return;
  }

  if (evt.type === "error") {
    createCard("error", "Run Failed", evt.message || "Unknown process error.");
    return;
  }

  if (evt.type === "event") {
    const e = evt.event;

    if (e.type === "item.completed" && e.item?.type === "agent_message") {
      createCard("agent", "Agent Message", e.item.text);
      return;
    }

    if (e.type === "assistant" && e.message) {
      const contentParts = Array.isArray(e.message.content) ? e.message.content : [];
      const text = contentParts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("\n");
      if (text) {
        createCard("agent", "Claude", text);
      }
      return;
    }

    if (e.type === "result") {
      const cost = typeof e.total_cost_usd === "number" ? `$${e.total_cost_usd.toFixed(4)}` : "N/A";
      const turns = typeof e.num_turns === "number" ? e.num_turns : "?";
      createEventRow("usage", "Result", `${kindLabel(e.subtype || "done")} | turns: ${turns} | cost: ${cost}`);
      return;
    }

    if ((e.type === "item.started" || e.type === "item.completed") && e.item) {
      renderToolEvent(e);
      return;
    }

    if (e.type === "turn.completed" && e.usage) {
      createEventRow("usage", "Usage", `in ${e.usage.input_tokens} | out ${e.usage.output_tokens} | reasoning ${e.usage.reasoning_output_tokens || 0}`);
      return;
    }

    if (e.type === "thread.started") {
      createEventRow("info", "Thread Started", e.thread_id || "Started");
      return;
    }

    if (e.type === "turn.started") {
      createEventRow("info", "Turn Started", "Processing the run");
      return;
    }

    if (e.type === "turn.failed") {
      createEventRow("error", "Turn Failed", summarizePreview(JSON.stringify(e, null, 2)));
      return;
    }

    createEventRow("tool", kindLabel(e.type), summarizePreview(JSON.stringify(e), 320));
    return;
  }

  if (evt.type === "exit") {
    createEventRow(evt.code === 0 ? "success" : "error", "Process Exit", `code ${evt.code}`);
  }
}

function stopRunStatePolling() {
  if (!state.pollTimer) return;
  clearInterval(state.pollTimer);
  state.pollTimer = null;
}

function startRunStatePolling() {
  if (state.pollTimer) return;
  state.pollTimer = window.setInterval(() => {
    syncRunState().catch((err) => {
      createCard("error", "Run State Sync Failed", err.message);
      stopRunStatePolling();
    });
  }, RUN_STATE_POLL_MS);
}

async function syncRunState({ full = false } = {}) {
  const params = new URLSearchParams();
  params.set("pipeline", state.activePipelineKey);
  if (!full && state.runId) params.set("after", String(state.lastEventSeq));
  const query = `?${params.toString()}`;
  const res = await fetch(`/api/run-state${query}`, { cache: "no-store" });
  const data = await res.json();

  refreshWorkspaceStateFromPayload(data.workspaceState);

  const run = data.run || null;
  const incomingRunId = run?.runId || null;
  const runChanged = incomingRunId !== state.runId;

  if (runChanged) {
    clearOutput();
    state.runId = incomingRunId;
    state.lastEventSeq = 0;
    if (incomingRunId) {
      createRunSummaryFromRun(run);
    }
  } else if (incomingRunId && output.children.length === 0) {
    createRunSummaryFromRun(run);
  }

  const events = Array.isArray(data.events) ? data.events : [];
  for (const evt of events) {
    renderEvent(evt);
    state.lastEventSeq = Math.max(state.lastEventSeq, Number(evt.seq || 0));
  }

  updateStatusFromRun(run);

  if (run?.active) {
    startRunStatePolling();
  } else {
    stopRunStatePolling();
  }
}

async function loadConfig() {
  const query = state.activePipelineKey ? `?pipeline=${encodeURIComponent(state.activePipelineKey)}` : "";
  const res = await fetch(`/api/config${query}`, { cache: "no-store" });
  const data = await res.json();
  state.pipelines = data.pipelines || {};
  state.activePipelineKey = data.activePipelineKey || data.defaultPipelineKey || state.activePipelineKey || "startup";
  state.prompts = data.prompts || {};
  state.stages = data.stages || {};
  state.stageOrder = Array.isArray(data.stageOrder) ? data.stageOrder : Object.keys(state.stages);
  state.defaultStageKey = data.defaultStageKey || "generateIdeas";

  cwdInput.value = data.workspaceDir;
  searchInput.checked = data.defaultSearch !== false;

  if (providerInput && Array.isArray(data.providers)) {
    const currentProvider = providerInput.value;
    providerInput.innerHTML = "";
    for (const p of data.providers) {
      const option = document.createElement("option");
      option.value = p;
      option.textContent = p.charAt(0).toUpperCase() + p.slice(1);
      providerInput.appendChild(option);
    }
    providerInput.value = data.providers.includes(currentProvider) ? currentProvider : data.providers[0];
  }
  updateRunButtonLabel();
  updateSearchVisibility();

  refreshWorkspaceStateFromPayload(data.workspaceState);
  renderPipelineInput();
  applyStage(state.defaultStageKey);
}

function renderPipelineInput() {
  if (!pipelineInput) return;
  const currentValue = pipelineInput.value || state.activePipelineKey;
  pipelineInput.innerHTML = "";
  for (const pipeline of Object.values(state.pipelines)) {
    const option = document.createElement("option");
    option.value = pipeline.key;
    option.textContent = pipeline.label || pipeline.key;
    pipelineInput.appendChild(option);
  }
  pipelineInput.value = state.pipelines[currentValue] ? currentValue : state.activePipelineKey;
}

async function readErrorResponse(res) {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    return parsed.error || text;
  } catch {
    return text;
  }
}

async function reseedWorkspace() {
  const pipeline = state.pipelines[state.activePipelineKey] || {};
  const confirmed = window.confirm(
    `Reset ${pipeline.label || "this path"} to its template files?\n\nThis will overwrite only:\n${cwdInput.value}`
  );

  if (!confirmed) {
    createCard("info", "Reset Cancelled", "The workspace was left unchanged.");
    return;
  }

  const res = await fetch("/api/seed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ pipelineKey: state.activePipelineKey })
  });
  const data = await res.json();
  createCard("success", "Workspace Reset", `Templated files were restored for ${pipeline.label || data.pipelineKey}:\n${data.workspaceDir}`);
  await syncRunState({ full: true });
}

async function overrideGate() {
  const target = getOverrideTarget();
  if (!target) {
    createCard("error", "Override Unavailable", "Select a stage with a specific gate first.");
    return;
  }

  const reason = window.prompt(
    `Override ${target.gateFile} and mark it PASS.\n\nEnter a short reason for the audit trail:`
  );

  if (reason === null) {
    return;
  }

  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    createCard("error", "Reason Required", "Enter a short reason before overriding a gate.");
    return;
  }

  const confirmed = window.confirm(
    `Mark ${target.gateFile} as PASS and unlock downstream stages?\n\nThis bypasses the current gate verdict.`
  );

  if (!confirmed) {
    return;
  }

  const res = await fetch("/api/gate-override", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      stageKey: state.activeStageKey,
      gateFile: target.gateFile,
      reason: trimmedReason
    })
  });

  if (!res.ok) {
    createCard("error", "Override Failed", await readErrorResponse(res));
    await syncRunState({ full: true });
    return;
  }

  const data = await res.json();
  createCard(
    "success",
    "Gate Overridden",
    `Marked ${data.gateFile} as PASS.\n\nReason: ${data.reason}`
  );
  refreshWorkspaceStateFromPayload(data.workspaceState);
  await syncRunState({ full: true });
}

async function runPrompt() {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    createCard("error", "Prompt Required", "Enter a prompt before running.");
    return;
  }

  await requestBrowserNotificationPermission();

  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      cwd: cwdInput.value,
      model: modelInput.value.trim(),
      search: searchInput.checked,
      provider: providerInput ? providerInput.value : "codex",
      stageKey: state.activeStageKey,
      prompt
    })
  });

  if (!res.ok) {
    createCard("error", "Request Failed", await readErrorResponse(res));
    await syncRunState({ full: true });
    return;
  }

  await syncRunState({ full: true });
  startRunStatePolling();
}

if (stageButtons) {
  stageButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-stage-key]");
    if (!button) return;
    applyStage(button.getAttribute("data-stage-key"));
  });
}

runButton.addEventListener("click", () => {
  if (!state.running) {
    runPrompt().catch((err) => {
      createCard("error", "Run Failed", err.message);
    });
  }
});

stopButton.addEventListener("click", () => {
  clearOutput();
});

seedButton.addEventListener("click", () => {
  reseedWorkspace().catch((err) => createCard("error", "Seed Failed", err.message));
});

if (overrideGateButton) {
  overrideGateButton.addEventListener("click", () => {
    overrideGate().catch((err) => createCard("error", "Override Failed", err.message));
  });
}

if (providerInput) {
  providerInput.addEventListener("change", () => {
    updateRunButtonLabel();
    updateSearchVisibility();
  });
}

if (pipelineInput) {
  pipelineInput.addEventListener("change", () => {
    state.activePipelineKey = pipelineInput.value || "startup";
    state.runId = null;
    state.lastEventSeq = 0;
    clearOutput();
    loadConfig()
      .then(() => syncRunState({ full: true }))
      .catch((err) => createCard("error", "Path Load Failed", err.message));
  });
}

loadConfig()
  .then(() => syncRunState({ full: true }))
  .catch((err) => createCard("error", "Config Load Failed", err.message));

const form = document.querySelector("#pilotForm");
const statusBox = document.querySelector("#formStatus");
const previewButton = document.querySelector("#previewRoutingButton");
const mobileCta = document.querySelector(".mobile-cta");
const ctaLinks = document.querySelectorAll('a[href="#pilot"]');

const excludedTerms = [
  "submit permits",
  "permit filing",
  "plan set",
  "plan-set",
  "pto",
  "interconnection",
  "homeowner",
  "inspection dispatch",
  "national ahj",
  "expediting",
  "permit runner",
  "call the ahj",
  "do the permitting"
];

function emitEvent(name, detail = {}) {
  window.dispatchEvent(new CustomEvent("queuepermit:event", { detail: { name, ...detail } }));
}

document.querySelectorAll("[data-track]").forEach((element) => {
  element.addEventListener("click", () => emitEvent(element.dataset.track, { cta_label: element.textContent.trim() }));
});

document.querySelectorAll(".filter-pill").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter-pill").forEach((item) => {
      const selected = item === button;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  });
});

document.querySelectorAll(".row-toggle").forEach((button) => {
  button.addEventListener("click", () => {
    const card = button.closest(".mobile-row-card");
    const expanded = !card.classList.contains("expanded");
    card.classList.toggle("expanded", expanded);
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    button.textContent = expanded ? "Collapse row" : "Expand row";
  });
});

ctaLinks.forEach((link) => {
  link.addEventListener("click", () => {
    window.setTimeout(() => {
      const firstField = form?.querySelector("input, select, textarea");
      firstField?.focus({ preventScroll: true });
    }, 220);
  });
});

function clearFieldErrors() {
  form.querySelectorAll("[data-field-error]").forEach((error) => error.remove());
  form.querySelectorAll("[aria-invalid='true']").forEach((field) => {
    field.removeAttribute("aria-invalid");
    const describedBy = (field.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter((id) => id && !id.endsWith("Error"))
      .join(" ");
    if (describedBy) {
      field.setAttribute("aria-describedby", describedBy);
    } else {
      field.removeAttribute("aria-describedby");
    }
  });
}

function setFieldError(field, message) {
  const name = field.name || "field";
  const error = document.createElement("small");
  error.id = `${name}Error`;
  error.dataset.fieldError = "true";
  error.className = "field-error";
  error.textContent = message;
  field.setAttribute("aria-invalid", "true");
  field.setAttribute("aria-describedby", `${field.getAttribute("aria-describedby") || ""} ${error.id}`.trim());
  const container = field.closest("label, fieldset") || field.parentElement;
  container?.append(error);
}

function validatePreviewForm() {
  clearFieldErrors();
  const invalidField = [...form.querySelectorAll("input, select, textarea")].find((field) => !field.checkValidity());
  if (!invalidField) return true;

  const messages = {
    email: "Please use a valid work email.",
    role: "Please select your role.",
    issue: "Please describe the weekly permit-review issue in one or two sentences.",
    scope: "Please confirm the v1 scope boundary before submitting."
  };
  setFieldError(invalidField, messages[invalidField.name] || "Please complete this required field.");
  invalidField.focus();
  return false;
}

function hasExcludedNeed(text) {
  const normalized = text.toLowerCase();
  return excludedTerms.some((term) => normalized.includes(term));
}

function validQueuePain(text) {
  return /stale|owner|blocker|revision|external|ahj|weekly|cycle|queue|status/i.test(text);
}

function classifyLead(data) {
  const jobFit = ["30-60", "61-150", "150+"].includes(data.get("jobs"));
  const ahjFit = ["8-10", "11+"].includes(data.get("ahjs"));
  const baseline = data.get("baseline");
  const manager = data.get("manager");
  const approver = data.get("approver");
  const issue = data.get("issue") || "";

  if (!data.get("scope") || baseline === "No" || manager === "No" || hasExcludedNeed(issue)) {
    return {
      type: "low",
      message:
        "QueuePermit v1 is not the right first tool for this need. The current pilot is limited to post-design permit operations tracking and weekly queue review; it does not submit permits, generate plan sets, automate PTO, provide homeowner updates, dispatch inspections, maintain national AHJ research, or staff expediting."
    };
  }

  if (jobFit && ahjFit && baseline === "Yes" && manager === "Yes" && approver === "Yes" && validQueuePain(issue)) {
    return {
      type: "strong",
      message:
        "Qualified pilot request received. QueuePermit will review the request within 2 business days, reply with the v1 scope, and ask for a sanitized baseline export before scheduling a pilot-review call."
    };
  }

  return {
      type: "possible",
      message:
      "Request received for manual review. QueuePermit will confirm whether the pilot scope fits before asking for data or scheduling time."
  };
}

function previewRouting(event) {
  event.preventDefault();
  statusBox.className = "form-status disabled";

  if (!validatePreviewForm()) {
    statusBox.textContent = "Please complete the required fields and confirm the v1 scope boundary before previewing routing.";
    emitEvent("field_validation_error", { form_version: "v1.0" });
    return;
  }

  const result = classifyLead(new FormData(form));
  statusBox.className = `form-status ${result.type}`;
  statusBox.textContent = result.message;
  emitEvent("form_preview_attempt", { form_version: "v1.0", fit_result: result.type });
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  statusBox.className = "form-status disabled";
  statusBox.textContent = "Pilot intake is not open yet.";
});

previewButton?.addEventListener("click", (event) => previewRouting(event));

function updateMobileCta() {
  if (!mobileCta) return;
  mobileCta.classList.toggle("is-visible", window.scrollY > Math.min(760, window.innerHeight * 0.9));
}

window.addEventListener("scroll", updateMobileCta, { passive: true });
updateMobileCta();

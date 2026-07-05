(function () {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    document.body.classList.add("reduced-motion");
  }

  const reviewSurface = document.querySelector(".review-surface");
  const statusPill = document.querySelector(".status-pill");
  const feedback = document.querySelector(".feedback-note");
  const form = document.querySelector(".pilot-form");
  const formMessage = document.getElementById("formMessage");
  const submitButton = form ? form.querySelector(".form-submit") : null;
  const successState = form ? form.querySelector(".success-state") : null;
  const accessPanel = document.getElementById("access-code");
  const accessInput = document.getElementById("accessCode");
  const codeMessage = document.getElementById("codeMessage");

  const states = ["flagged", "assigned", "recorded"];
  const stateCopy = {
    flagged: {
      pill: "Review required",
      note: "Analyst note: corridor drift is visible; request source-system export before escalation.",
      button: "View the packet"
    },
    assigned: {
      pill: "Assigned to reviewer",
      note: "Analyst note: A. Tan owns the review; compare the new counterparty with prior SG-HK exports.",
      button: "Record decision"
    },
    recorded: {
      pill: "Decision recorded",
      note: "Analyst note: decision note exported with baseline deviation, reason stack, and model-run trace.",
      button: "Reset review"
    }
  };

  function scrollToTarget(selector, focusAfter) {
    const target = document.querySelector(selector);
    if (!target) return;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    if (focusAfter) {
      const focusTarget = document.querySelector(focusAfter);
      window.setTimeout(() => focusTarget && focusTarget.focus({ preventScroll: true }), reduceMotion ? 0 : 420);
    }
  }

  document.querySelectorAll("[data-scroll-target]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const selector = button.getAttribute("data-scroll-target");
      const focusAfter = selector === "#pilot-access" ? "#workEmail" : null;
      event.preventDefault();
      scrollToTarget(selector, focusAfter);
    });
  });

  document.querySelectorAll("[data-open-access]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      if (accessPanel) {
        accessPanel.classList.add("is-open");
      }
      scrollToTarget("#access-code", "#accessCode");
    });
  });

  function setReviewState(nextState) {
    if (!reviewSurface || !stateCopy[nextState]) return;
    reviewSurface.dataset.reviewState = nextState;
    if (statusPill) statusPill.textContent = stateCopy[nextState].pill;
    if (feedback) feedback.textContent = stateCopy[nextState].note;
    document.querySelectorAll("[data-advance-review]").forEach((button) => {
      button.textContent = stateCopy[nextState].button;
    });
  }

  document.querySelectorAll("[data-advance-review]").forEach((button) => {
    button.addEventListener("click", () => {
      const current = reviewSurface ? reviewSurface.dataset.reviewState : "flagged";
      const index = states.indexOf(current);
      const next = states[(index + 1) % states.length];
      setReviewState(next);
      if (reviewSurface) {
        reviewSurface.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      }
    });
  });

  function isPersonalEmail(value) {
    return /@(gmail|googlemail|yahoo|hotmail|outlook|icloud|aol|proton|pm)\./i.test(value);
  }

  function validateForm() {
    if (!form || !formMessage) return false;
    const fields = Array.from(form.querySelectorAll("input[required], textarea[required], select[required]"));
    let firstInvalid = null;
    fields.forEach((field) => {
      const empty = !field.value.trim();
      field.setAttribute("aria-invalid", empty ? "true" : "false");
      if (empty && !firstInvalid) firstInvalid = field;
    });

    const email = form.querySelector('input[name="workEmail"]');
    if (email && email.value.trim() && (!email.validity.valid || isPersonalEmail(email.value.trim()))) {
      email.setAttribute("aria-invalid", "true");
      firstInvalid = firstInvalid || email;
      formMessage.textContent = "Use a company email so we can verify the request.";
      firstInvalid.focus();
      return false;
    }

    if (firstInvalid) {
      formMessage.textContent = "Complete the required pilot-fit fields before submitting.";
      firstInvalid.focus();
      return false;
    }

    formMessage.textContent = "";
    return true;
  }

  if (form) {
    form.addEventListener("input", (event) => {
      if (event.target.matches("input, textarea, select")) {
        event.target.setAttribute("aria-invalid", "false");
      }
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!validateForm()) return;

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Reviewing fit...";
      }
      if (formMessage) {
        formMessage.textContent = "";
      }

      window.setTimeout(() => {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = submitButton.dataset.defaultLabel || "Request pilot access";
        }
        if (successState) {
          successState.hidden = false;
          successState.focus?.();
        }
        if (formMessage) {
          formMessage.classList.add("success");
          formMessage.textContent = "Request received.";
        }
      }, reduceMotion ? 0 : 520);
    });
  }

  const codeForm = document.querySelector(".code-form");
  if (codeForm) {
    codeForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!codeMessage) return;
      const code = accessInput ? accessInput.value.trim().toUpperCase() : "";
      codeMessage.classList.remove("success");

      if (!code) {
        codeMessage.textContent = "Enter the code from your invitation to open the synthetic corridor preview.";
        accessInput && accessInput.focus();
        return;
      }

      codeMessage.textContent = "Checking code...";

      window.setTimeout(() => {
        // Synthetic preview behavior only. There is no real authentication or entitlement check.
        if (code === "BB-PILOT") {
          codeMessage.classList.add("success");
          codeMessage.textContent = "Access code accepted. Opening synthetic corridor review.";
          setReviewState("assigned");
          scrollToTarget("#packet");
        } else if (code === "EXPIRED") {
          codeMessage.textContent = "This preview code has expired. Request pilot access with your current corridor details.";
        } else {
          codeMessage.textContent = "That code does not match an active preview. Check the invitation or request pilot access.";
        }
      }, reduceMotion ? 0 : 360);
    });
  }

  window.addEventListener("error", () => {
    if (formMessage && !formMessage.textContent) {
      formMessage.textContent = "This static preview could not submit your request. Try again later or use your access code if you have one.";
    }
  });
})();

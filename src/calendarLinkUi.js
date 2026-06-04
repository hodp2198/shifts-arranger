(function () {
  const SAFE_CALENDAR_LINK_LENGTH = 2000;
  const LONG_LINK_WARNING = "הקישור ארוך ועלול להיחתך בוואטסאפ. מומלץ לבדוק אותו לפני שליחה.";
  const LINK_CREATED_MESSAGE = "קישור יומן נוצר לסידור הסופי.";
  const LINK_COPIED_MESSAGE = "✓ הקישור הועתק";

  function statusForGeneratedLink(link) {
    return String(link || "").length > SAFE_CALENDAR_LINK_LENGTH
      ? LONG_LINK_WARNING
      : LINK_CREATED_MESSAGE;
  }

  function setGeneratedLink({ link, inputEl, textEl, buttonEl, statusEl }) {
    inputEl.value = link;
    textEl.textContent = link;
    buttonEl.classList.add("has-link");
    statusEl.textContent = statusForGeneratedLink(link);
  }

  function showCopiedStatus(statusEl, duration = 2600) {
    statusEl.textContent = LINK_COPIED_MESSAGE;
    window.clearTimeout(showCopiedStatus.timer);
    showCopiedStatus.timer = window.setTimeout(() => {
      if (statusEl.textContent === LINK_COPIED_MESSAGE) {
        statusEl.textContent = "";
      }
    }, duration);
  }

  window.calendarLinkUi = {
    statusForGeneratedLink,
    setGeneratedLink,
    showCopiedStatus
  };
})();

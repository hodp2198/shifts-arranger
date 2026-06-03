(function () {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  function bytesToBase64Url(bytes) {
    let binary = "";
    bytes.forEach(byte => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlToBytes(value) {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
  }

  function encodePayload(payload) {
    return bytesToBase64Url(textEncoder.encode(JSON.stringify(payload)));
  }

  function decodePayload(value) {
    return JSON.parse(textDecoder.decode(base64UrlToBytes(value)));
  }

  function createScheduleId() {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    return `schedule-${bytesToBase64Url(bytes)}`;
  }

  function employeeId(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0591-\u05C7]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "employee";
  }

  function createEmployeeExportLink(payload, pagePath) {
    const url = new URL(pagePath, window.location.href);
    url.hash = `data=${encodePayload(payload)}`;
    return url.href;
  }

  function readPayloadFromHash() {
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const data = params.get("data");
    return data ? decodePayload(data) : null;
  }

  window.scheduleExport = {
    createScheduleId,
    employeeId,
    createEmployeeExportLink,
    readPayloadFromHash
  };
})();

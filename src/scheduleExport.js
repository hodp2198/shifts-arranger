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

  async function compressText(value) {
    if (!("CompressionStream" in window)) return null;
    const stream = new Blob([value]).stream().pipeThrough(new CompressionStream("gzip"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }

  async function decompressText(value) {
    if (!("DecompressionStream" in window)) {
      throw new Error("This browser cannot open compressed schedule links.");
    }
    const stream = new Blob([base64UrlToBytes(value)]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
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

  function compactPayload(payload) {
    const employeeNames = (payload.employees || []).map(employee => employee.name);
    const employeeIndexes = new Map(employeeNames.map((name, index) => [name, index]));
    return {
      v: 2,
      id: payload.scheduleId,
      c: payload.createdAt,
      tz: payload.timezone,
      w: (payload.weeks || []).map(week => [week.startDate, week.endDate, week.label]),
      e: employeeNames,
      d: (payload.entries || []).map(entry => {
        const night1 = entry.assignments?.find(assignment => assignment.role === "night1");
        const night2 = entry.assignments?.find(assignment => assignment.role === "night2");
        return [
          entry.date,
          entry.dayName,
          night1 ? employeeIndexes.get(night1.employeeName) : -1,
          night2 ? employeeIndexes.get(night2.employeeName) : -1
        ];
      })
    };
  }

  function expandCompactPayload(payload) {
    if (!payload || payload.v !== 2) return payload;
    const employees = (payload.e || []).map(name => ({
      id: employeeId(name),
      name
    }));
    return {
      scheduleId: payload.id,
      createdAt: payload.c,
      timezone: payload.tz || "Asia/Jerusalem",
      weeks: (payload.w || []).map((week, index) => ({
        index,
        startDate: week[0],
        endDate: week[1],
        label: week[2] || ""
      })),
      employees,
      entries: (payload.d || []).map(entry => {
        const assignments = [];
        const night1Name = payload.e?.[entry[2]];
        const night2Name = payload.e?.[entry[3]];
        if (night1Name) {
          assignments.push({ employeeName: night1Name, role: "night1", title: "נייט 1" });
        }
        if (night2Name) {
          assignments.push({ employeeName: night2Name, role: "night2", title: "נייט 2" });
        }
        return {
          date: entry[0],
          dayName: entry[1],
          assignments
        };
      }).filter(entry => entry.assignments.length),
      whatsappText: ""
    };
  }

  async function createEmployeeExportLink(payload, pagePath) {
    const url = new URL(pagePath, window.location.href);
    const compact = JSON.stringify(compactPayload(payload));
    const compressed = await compressText(compact);
    url.hash = compressed
      ? `z=${bytesToBase64Url(compressed)}`
      : `p=${bytesToBase64Url(textEncoder.encode(compact))}`;
    return url.href;
  }

  async function readPayloadFromHash() {
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const compressed = params.get("z");
    if (compressed) {
      return expandCompactPayload(JSON.parse(await decompressText(compressed)));
    }
    const packed = params.get("p");
    if (packed) {
      return expandCompactPayload(JSON.parse(textDecoder.decode(base64UrlToBytes(packed))));
    }
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

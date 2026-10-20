/* Lossless runtime snapshots stay separate from the editable draft fields. */
(function (root) {
  function encode(value) {
    if (value instanceof Date) return { __draftType: "Date", value: Number.isFinite(value.getTime()) ? value.toISOString() : null };
    if (value instanceof Set) return { __draftType: "Set", value: [...value].map(encode) };
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
    }
    return value;
  }

  function decode(value) {
    if (value?.__draftType === "Date") return new Date(value.value === null ? NaN : value.value);
    if (value?.__draftType === "Set") return new Set(value.value.map(decode));
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
    }
    return value;
  }

  const api = { stringify: value => JSON.stringify(encode(value)), parse: text => decode(JSON.parse(text)) };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.draftSnapshot = api;
})(typeof window !== "undefined" ? window : null);

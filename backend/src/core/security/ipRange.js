"use strict";

const net = require("node:net");

/**
 * "Is this address inside one of these ranges?" for the IP allowlist.
 *
 * Accepts plain addresses ("203.0.113.14"), IPv4 CIDR ("10.0.0.0/8"),
 * IPv6 CIDR ("2001:db8::/32") and the IPv4-mapped form Node reports on a
 * dual-stack socket ("::ffff:203.0.113.14"). A malformed entry never
 * matches — and never throws — so one typo in the list cannot take the
 * whole check down with it.
 */

function normalise(address) {
  const value = String(address || "").trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value);
  return mapped ? mapped[1] : value;
}

function ipv4ToInt(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function ipv6ToBigInt(address) {
  const [head, tail = ""] = address.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  // An embedded IPv4 in the last group ("::ffff:1.2.3.4") splits into two.
  const expand = (parts) =>
    parts.flatMap((p) => {
      if (p.includes(".")) {
        const v4 = ipv4ToInt(p);
        if (v4 === null) throw new Error("bad");
        return [(v4 >>> 16).toString(16), (v4 & 0xffff).toString(16)];
      }
      return [p];
    });
  const h = expand(headParts);
  const t = expand(tailParts);
  const missing = 8 - h.length - t.length;
  if (missing < 0 || (missing > 0 && !address.includes("::"))) throw new Error("bad");
  const groups = [...h, ...Array(Math.max(0, missing)).fill("0"), ...t];
  if (groups.length !== 8) throw new Error("bad");
  let out = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) throw new Error("bad");
    out = (out << 16n) | BigInt(parseInt(g, 16));
  }
  return out;
}

function matches(address, range) {
  const ip = normalise(address);
  const rule = String(range || "").trim();
  if (!ip || !rule) return false;

  const [base, prefixText] = rule.split("/");
  const baseIp = normalise(base);
  const version = net.isIP(ip);
  const ruleVersion = net.isIP(baseIp);
  if (!version || !ruleVersion || version !== ruleVersion) return false;

  const prefix = prefixText === undefined ? (version === 4 ? 32 : 128) : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > (version === 4 ? 32 : 128)) return false;

  try {
    if (version === 4) {
      const a = ipv4ToInt(ip);
      const b = ipv4ToInt(baseIp);
      if (a === null || b === null) return false;
      if (prefix === 0) return true;
      const mask = prefix === 32 ? 0xffffffff : (~0 << (32 - prefix)) >>> 0;
      return ((a & mask) >>> 0) === ((b & mask) >>> 0);
    }
    const a = ipv6ToBigInt(ip);
    const b = ipv6ToBigInt(baseIp);
    if (prefix === 0) return true;
    const shift = BigInt(128 - prefix);
    return a >> shift === b >> shift;
  } catch {
    return false;
  }
}

/** True when the list is empty (no restriction) or the address matches an entry. */
function isAllowed(address, ranges) {
  const list = (Array.isArray(ranges) ? ranges : []).map((r) => String(r || "").trim()).filter(Boolean);
  if (!list.length) return true;
  return list.some((range) => matches(address, range));
}

/** Validation for the settings screen: which entries are not usable. */
function invalidEntries(ranges) {
  return (Array.isArray(ranges) ? ranges : []).filter((r) => {
    const rule = String(r || "").trim();
    if (!rule) return false;
    const [base, prefix] = rule.split("/");
    const version = net.isIP(normalise(base));
    if (!version) return true;
    if (prefix === undefined) return false;
    const n = Number(prefix);
    return !Number.isInteger(n) || n < 0 || n > (version === 4 ? 32 : 128);
  });
}

module.exports = { matches, isAllowed, invalidEntries, normalise };

import { BlockList, isIP } from "node:net";

/** Addresses a scan must never connect to: private, loopback, link-local, CGNAT, multicast, reserved, documentation. */
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["100::", 64], ["2001:db8::", 32], ["2001::", 32], ["2002::", 16],
  ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(net, prefix, "ipv6");

function embeddedV4(ip: string): string | null {
  const lower = ip.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d / ::ffff:7f00:1), IPv4-compatible, NAT64 (64:ff9b::/96)
  const m = /^(?:::ffff:|::|64:ff9b::)(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(lower);
  if (!m) return null;
  if (m[1]) return m[1];
  const hi = parseInt(m[2]!, 16);
  const lo = parseInt(m[3]!, 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}

/** True only for globally routable unicast addresses. Anything unparseable is not public. */
export function isPublicAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const family = isIP(bare);
  if (family === 4) return !blocked.check(bare, "ipv4");
  if (family === 6) {
    const v4 = embeddedV4(bare);
    if (v4) return isPublicAddress(v4);
    return !blocked.check(bare, "ipv6");
  }
  return false;
}

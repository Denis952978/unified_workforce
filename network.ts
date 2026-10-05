const ipInt = (ip: string) => ip.split('.').reduce((a, b) => a * 256 + (+b), 0);
export function inCidr(ip: string, cidr: string) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const [base, bits] = String(cidr).split('/'); const b = +bits; if (!(b >= 0 && b <= 32) || !/^\d+\.\d+\.\d+\.\d+$/.test(base)) return false;
  const mask = b === 0 ? 0 : (0xFFFFFFFF << (32 - b)) >>> 0;
  return ((ipInt(ip) & mask) >>> 0) === ((ipInt(base) & mask) >>> 0);
}
export function zoneFor(ip: string, zones: { name: string; cidr: string; active: boolean }[] = []) {
  return zones.filter(z => z.active && inCidr(ip, z.cidr)).sort((a, b) => +b.cidr.split('/')[1] - +a.cidr.split('/')[1])[0] ?? null;
}
/** For the local dev server: only believe X-Forwarded-For written by a trusted proxy. On Netlify the platform supplies the address. */
export function forwardedIp(peer: string, xff: string | null, trusted: string[]) {
  peer = peer.replace(/^::ffff:/, '');
  if (!trusted.includes(peer)) return peer;
  const hops = String(xff || '').split(',').map(s => s.trim().replace(/^::ffff:/, '')).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) if (!trusted.includes(hops[i])) return hops[i];
  return peer;
}

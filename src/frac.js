// Exact rational arithmetic for musical time. A Frac is [num, den] with
// den > 0 and gcd(num, den) = 1. Using integers keeps every layout decision
// exact and identical on every machine (no floating-point drift in onsets).

const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };

export function F(n, d = 1) {
  if (d === 0) throw Error('zero denominator');
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d);
  return [n / g, d / g];
}
export const ZERO = F(0);
export const add = (a, b) => F(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
export const sub = (a, b) => F(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
export const mul = (a, b) => F(a[0] * b[0], a[1] * b[1]);
export const div = (a, b) => F(a[0] * b[1], a[1] * b[0]);
export const cmp = (a, b) => a[0] * b[1] - b[0] * a[1];
export const eq = (a, b) => a[0] === b[0] && a[1] === b[1];
export const lt = (a, b) => cmp(a, b) < 0;
export const val = (a) => a[0] / a[1];
export const key = (a) => `${a[0]}/${a[1]}`;
export const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;

/**
 * Split a written duration into note values: [{type, dots}] where type is a
 * Frac power of two (1 = whole note). A duration that one note cannot show
 * (5/8, say) becomes several notes, longest first, to be tied.
 */
export function noteValues(d) {
  const out = [];
  let rest = d;
  let guard = 0;
  while (rest[0] > 0 && guard++ < 8) {
    let found = null;
    for (let e = 1; e >= -7; e--) { // breve (2) down to 1/128
      const t = e >= 0 ? F(2 ** e) : F(1, 2 ** -e);
      for (const [dots, m] of [[2, F(7, 4)], [1, F(3, 2)], [0, F(1)]]) {
        const v = mul(t, m);
        if (cmp(v, rest) <= 0) { found = { type: t, dots, value: v }; break; }
      }
      if (found) break;
    }
    if (!found) break;
    out.push({ type: found.type, dots: found.dots });
    rest = sub(rest, found.value);
  }
  return out;
}

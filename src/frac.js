// Exact rational arithmetic for musical time. A Frac is [num, den] with
// den > 0 and gcd(num, den) = 1, as PostScript prints them (sm-abc-json).
// Integers keep note times exact and identical on every machine (no
// floating-point drift in onsets) until they become MIDI ticks or seconds.

const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };

export function F(n, d = 1) {
  if (d === 0) throw Error('zero denominator');
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d);
  return [n / g, d / g];
}
export const add = (a, b) => F(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
export const val = (a) => a[0] / a[1];

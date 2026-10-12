export function tokenValue(value) {
  if (!value || ['blank', 'null'].includes(value)) return '';
  if (/\s/.test(value) || value.startsWith('example:')) throw new Error('Bearer token must be a single nonempty token, not an example command');
  return value;
}
export async function authorized(request, token) {
  if (!token) return true;
  const presented = request.headers.get('authorization') ?? '';
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([presented, `Bearer ${token}`].map(v => crypto.subtle.digest('SHA-256', encode.encode(v))));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let different = 0;
  for (let i = 0; i < left.length; i++) different |= left[i] ^ right[i];
  return different === 0;
}

// Keep participant credentials in the fragment: GitHub Pages does not need them.
// The entry version reloads current HTML while old room QR codes remain valid.
export const ROOM_ENTRY_VERSION = '20261103-reconnect';

const validToken = value => typeof value === 'string' && /^[-_A-Za-z0-9]{32}$/.test(value);

function invitationUrl(text, baseUrl) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    const url = new URL(text, baseUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch { return null; }
}

export function createRoomInvitation(locationUrl, credentials) {
  const url = invitationUrl(locationUrl);
  if (!url || !validToken(credentials?.roomId) || !validToken(credentials?.joinToken)) return null;
  url.search = '';
  url.searchParams.set('v', ROOM_ENTRY_VERSION);
  url.hash = `capture-panel?${new URLSearchParams({room: credentials.roomId, join: credentials.joinToken})}`;
  // Only the two explicitly selected participant fields are serialized.
  return url.href;
}

export function parseRoomInvitation(text, baseUrl) {
  const url = invitationUrl(text, baseUrl);
  if (!url) return null;
  const queryStart = url.hash.indexOf('?');
  if (queryStart < 0) return null;
  const query = new URLSearchParams(url.hash.slice(queryStart + 1));
  if (query.getAll('room').length !== 1 || query.getAll('join').length !== 1) return null;
  const roomId = query.get('room'), joinToken = query.get('join');
  return validToken(roomId) && validToken(joinToken) ? {roomId, joinToken} : null;
}

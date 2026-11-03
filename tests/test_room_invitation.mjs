import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoomInvitation, parseRoomInvitation, ROOM_ENTRY_VERSION} from '../static/room-invitation.mjs';

const base = 'https://bybybye317-source.github.io/emotion-exhibition/';
const credentials = {roomId: 'r'.repeat(32), joinToken: 'j'.repeat(32)};
const fragment = `?room=${credentials.roomId}&join=${credentials.joinToken}`;

test('new QR entry loads the current HTML version and preserves the project subpath', () => {
  const link = createRoomInvitation(`${base}?v=old&preview=anger&mode=host#music-panel`, credentials);
  const url = new URL(link);
  assert.equal(url.origin + url.pathname, base);
  assert.deepEqual([...url.searchParams], [['v', ROOM_ENTRY_VERSION]]);
  assert.equal(url.hash, `#capture-panel${fragment}`);
  assert.deepEqual(parseRoomInvitation(link), credentials);
});

test('participant credentials stay in the fragment and host credentials are never emitted', () => {
  const hostToken = 'h'.repeat(32);
  const link = createRoomInvitation(`${base}?hostToken=${hostToken}&room=old#gallery-panel?hostToken=${hostToken}`, {...credentials, hostToken});
  const url = new URL(link);
  assert.equal(url.searchParams.has('room'), false);
  assert.equal(url.searchParams.has('join'), false);
  assert.equal(link.includes(hostToken), false);
  assert.equal(link.includes('hostToken'), false);
  assert.deepEqual(parseRoomInvitation(link), credentials);
});

test('existing unversioned QR codes and earlier version URLs remain valid', () => {
  for (const query of ['', '?v=20261029-contribution', '?v=20261103-auto']) {
    assert.deepEqual(parseRoomInvitation(`${base}${query}#capture-panel${fragment}`), credentials);
  }
});

test('changing the displayed view preserves the same participant invitation', () => {
  const link = createRoomInvitation(base, credentials);
  for (const view of ['gallery', 'portrait', 'music', 'scent', 'capture']) {
    const url = new URL(link);
    url.hash = `${view}-panel${fragment}`;
    assert.deepEqual(parseRoomInvitation(url.href), credentials);
  }
});

test('relative fragment links can be pasted against the current page', () => {
  assert.deepEqual(parseRoomInvitation(`#gallery-panel${fragment}`, base), credentials);
  assert.deepEqual(parseRoomInvitation(`  ${base}#capture-panel${fragment}  `), credentials);
});

test('the parser returns only participant credentials even if extra fields appear', () => {
  assert.deepEqual(parseRoomInvitation(`${base}#capture-panel${fragment}&hostToken=${'h'.repeat(32)}`), credentials);
});

test('tokens support URL-safe mixed case, digits, hyphens and underscores', () => {
  const mixed = {roomId: 'Aa0_-'.repeat(6) + 'Z9', joinToken: 'zZ9_-'.repeat(6) + 'A0'};
  assert.deepEqual(parseRoomInvitation(createRoomInvitation(base, mixed)), mixed);
});

test('malformed, incomplete and ambiguous invitation inputs return null', () => {
  const invalid = [null, undefined, 4, {}, '', 'not a URL', base,
    `${base}?room=${credentials.roomId}&join=${credentials.joinToken}`,
    `${base}#capture-panel?room=${credentials.roomId}`,
    `${base}#capture-panel?room=${'r'.repeat(31)}&join=${credentials.joinToken}`,
    `${base}#capture-panel?room=${credentials.roomId}&join=${'j'.repeat(33)}`,
    `${base}#capture-panel?room=${credentials.roomId}&join=${'!'.repeat(32)}`,
    `${base}#capture-panel${fragment}&room=${credentials.roomId}`,
    `${base}#capture-panel${fragment}&join=${credentials.joinToken}`,
    `javascript:alert(1)#capture-panel${fragment}`,
    `https://user:password@example.com/#capture-panel${fragment}`,
  ];
  for (const input of invalid) assert.equal(parseRoomInvitation(input), null, String(input));
  assert.equal(parseRoomInvitation(`#capture-panel${fragment}`, 'invalid base'), null);
});

test('creating an invitation rejects invalid URLs and credentials without mutating input', () => {
  const original = Object.freeze({...credentials, hostToken: 'h'.repeat(32)});
  assert.ok(createRoomInvitation(base, original));
  for (const value of [null, {}, {...credentials, roomId: 'short'}, {...credentials, joinToken: 'bad token'}]) {
    assert.equal(createRoomInvitation(base, value), null);
  }
  for (const location of [null, '', 'invalid', 'file:///tmp/index.html', 'https://u:p@example.com/']) {
    assert.equal(createRoomInvitation(location, original), null);
  }
});

test('phone invitations never inherit automatic desktop hosting', () => {
  const url=new URL(createRoomInvitation(base+'?mode=host#gallery-panel',credentials));
  assert.equal(url.searchParams.has('mode'),false);
  assert.equal(url.hash.startsWith('#capture-panel?'),true);
});

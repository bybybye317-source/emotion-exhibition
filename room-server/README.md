# Classroom room relay

The GitHub Pages frontend uses `static/room-client.mjs` to contact the separately deployed HTTPS relay. The relay uses Cloudflare D1; it does not rely on isolate memory for shared state. Canonical hosting source is `../empathy-classroom-service`, with these modules copied under `lib/room/` and Drizzle migrations generated from `db/schema.ts`.

## Privacy and lifetime

- Room and host capabilities are independent random 192-bit tokens. Only SHA-256 digests are stored. The host token must never appear in an invitation link.
- Invitations put the room ID and join capability in a URL fragment, which is not sent to GitHub Pages. A holder of this link can view the classroom's current participant photos. Do not publish classroom invitations publicly.
- Every upload requires `consent:true`; the UI must explain that photo and score data are sent to the shared classroom.
- Rooms expire two hours after creation. Expiry is enforced before data access. Expired rows are removed during subsequent API traffic; `worker.mjs` also exports scheduled cleanup for deployments with a cron trigger.
- At most 32 photos remain in a room. New arrivals atomically evict older images. Host clear/end deletes photos and receipts. Client leave/expiry releases local object URLs.
- There is no list-all-rooms or unauthenticated photo endpoint. Server code does not log photos or capability tokens.
- Photo upload is compressed JPEG, maximum 240 KiB. Only finite bounded scores and normalized landmarks are retained. Client-side classifier outputs are not independently reclassified or identity-verified by the relay.

## Protocol

All JSON responses are `Cache-Control: no-store`. CORS permits the existing GitHub Pages origin and explicitly listed development origins. Browser requests use no cookies.

- `POST /api/rooms` → room ID, join token, host token, expiry and empty snapshot.
- `GET /api/rooms/:id` with join/host bearer token → snapshot; `?since=N` can return unchanged.
- `POST /api/rooms/:id/contributions` with join token and `{requestId,generation,scores,anchors,photoDataUrl,consent:true}` → record ID and snapshot.
- `GET /api/rooms/:id/photos/:recordId` with join/host token → JPEG.
- `POST /api/rooms/:id/reset` with host token → cleared snapshot and incremented generation.
- `DELETE /api/rooms/:id` with host token → closes room and removes photo data.

D1 batches atomically allocate sequence/slot, insert the photo, retain an idempotency receipt, and evict records beyond 32. A repeated request ID does not create a second contribution, even if the original photo has already been evicted. A reset increments the generation so delayed submissions from the previous round are rejected. All group scores are recomputed as equal-weight averages over the records stored by the server.

## Browser adapter

```js
const client = new RoomClient({
  baseUrl: 'https://empathy-gallery-classroom.bybybye317.chatgpt.site',
  onSnapshot(snapshot) { /* hydrated session, or null after invalidation */ },
  onStatus({status, detail}) { /* connecting/connected/offline/expired/left */ }
});
await client.createRoom();
await client.join({roomId, joinToken, hostToken}); // hostToken only for the host
await client.submit({blob, scores, anchors, consent: true});
await client.reset(); // host only
await client.close(); // host only
client.leave();
```

The adapter polls snapshots, downloads each new photo only once, converts authenticated responses into local blob URLs, and releases them when no longer retained. It preserves state during temporary disconnection, retries polling, and discards credentials/state if the room expires. A failed join rolls back to local mode. Retrying the same Blob reuses a request ID; UI code should retain a failed capture until submission succeeds or the visitor cancels it.

## Tests

Use the bundled Node 24 runtime (or a Node version with `node:sqlite`):

```sh
node --test room-server/test-rooms.mjs room-server/test-client.mjs
node room-server/test-miniflare.mjs
```

The first suite executes the actual SQL through an in-memory SQLite-backed D1 adapter, including bounding, expiry, auth, reset, duplicates, and malformed input. The Miniflare test executes the Worker and D1 runtime with six concurrent HTTP submissions, including duplicate retries. Its `miniflare` dependency is taken from the sibling hosted service checkout, rather than adding a production dependency to the static website.

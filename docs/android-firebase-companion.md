# Firebase Android notification companion

## Scope

The Android companion adds native, no-SMS Codex Gateway notifications with inline replies. Firebase
transports data-only messages; the Android app renders the notification locally so Android
`RemoteInput` can collect a reply.

The safety boundary is server-owned:

- The browser-authenticated registration endpoint creates a random per-device token.
- Only a hash of that device token is stored by the Gateway.
- The FCM registration token is encrypted in the existing Gateway SQLite database.
- A one-way FCM-token hash prevents one phone registration from becoming duplicate active devices.
- The server records the host, project, and thread when it sends each notification.
- The reply endpoint accepts a notification key and reply text, not a client-selected thread.
- Replies expire after seven days and use a client UUID for idempotency.
- Revoking a phone makes its device token unusable.

## Configure Firebase

1. Create a Firebase project and register Android package `co.spax.codexgateway`.
2. Enable the Firebase Cloud Messaging HTTP v1 API.
3. Create a dedicated service account with only the **Firebase Cloud Messaging API Admin** role.
4. Download its JSON key directly to the VPS. Do not paste it into chat or commit it.
5. Restrict the key file to the account that operates the Gateway container.

An example host location is:

```text
/srv/codex-gateway/secrets/firebase-service-account.json
```

Mount it read-only using a local, untracked Compose override:

```yaml
services:
  codex-gateway:
    environment:
      CODEX_GATEWAY_FIREBASE_CREDENTIALS_PATH: /run/secrets/codex-gateway-firebase.json
    volumes:
      - ./secrets/firebase-service-account.json:/run/secrets/codex-gateway-firebase.json:ro
```

Do not add the service-account JSON to an image or repository. The Android app uses only the
non-secret Firebase app configuration described in [`android/README.md`](../android/README.md).

## Registration and API boundaries

The authenticated Gateway session is used only to register/list/revoke phones:

- `POST /api/android/devices`
- `GET /api/android/devices`
- `DELETE /api/android/devices/:id`

The Android app then authenticates with `Authorization: Device <random-device-token>`:

- `POST /api/android/device/token` updates a rotated FCM token.
- `POST /api/android/device/reply` submits an idempotent inline reply.
- `POST /api/android/device/revoke` disconnects and revokes the current phone.

Never expose these routes without HTTPS. Never put a Gateway password, session token, device token,
or Firebase service-account key in a notification payload or log.

## Pre-deployment verification

1. Build the Gateway and configured APK from an isolated clean worktree.
2. Back up the Gateway database and current Compose/service configuration.
3. Deploy the Gateway image without restarting unrelated services.
4. Confirm the existing web Gateway is healthy before registering a phone.
5. Register one phone and verify its FCM token is not present as plaintext in SQLite.
6. Complete a synthetic Codex turn and verify exactly one notification arrives.
7. Reply with harmless text and verify exactly one new turn starts in that same thread.
8. Re-submit the same client message ID and verify it does not create a duplicate turn.
9. Verify a structured input-request notification has no Reply action.
10. Disconnect the phone and verify its former device token receives HTTP 401.

## Rollback

Remove `CODEX_GATEWAY_FIREBASE_CREDENTIALS_PATH` and its read-only volume mount, then deploy the prior
Gateway image. Android delivery becomes inert when the credential path is absent; existing Bark and
web notification behavior is unchanged. Revoked or stale Android device rows can remain inactive in
SQLite until a separately approved maintenance task removes them.

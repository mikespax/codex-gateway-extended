# Codex Gateway Extended Android companion

This small Android app receives Codex Gateway turn-completion notifications through Firebase
Cloud Messaging (FCM). A reply entered in the notification starts a new turn in the exact thread
recorded by the Gateway when the notification was sent.

The app stores a dedicated device token in Android Keystore. It never stores the user's Gateway
password. Disconnecting the phone revokes the device token on the Gateway before clearing it from
the phone.

## Firebase Android registration

1. Create or select a Firebase project.
2. Register an Android app with package name `co.spax.codexgateway`.
3. Obtain these non-secret identifiers from the Android app's Firebase configuration:
   - Firebase app ID (`mobilesdk_app_id`)
   - Firebase project ID (`project_id`)
   - Firebase API key (`current_key`)
4. Put the values in the user's `~/.gradle/gradle.properties`, or pass them with `-P` when building:

```properties
CODEX_FIREBASE_APPLICATION_ID=1:1234567890:android:example
CODEX_FIREBASE_PROJECT_ID=example-project
CODEX_FIREBASE_API_KEY=example-api-key
```

The checked-in values are placeholders. A build with placeholders opens but refuses registration.
The Firebase service-account key must never be placed in this Android directory or embedded in an
APK.

## Build

With Java 17 and Android SDK 35 installed:

```bash
cd android
./gradlew clean assembleDebug
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

## Connect the phone

1. Install the configured APK on an Android device with Google Play services.
2. Open it and allow notifications.
3. Keep the default Gateway URL (`https://codex.spax.co`).
4. Enter the existing Gateway username and password once and tap **Connect this phone**.
5. Confirm the app says both the phone and Gateway Firebase credential are ready.

Only terminal turn-completion and goal-completion notifications offer **Reply**. Input requests and
tmux-monitor notifications remain view-only because a short lock-screen reply cannot safely answer
structured prompts.

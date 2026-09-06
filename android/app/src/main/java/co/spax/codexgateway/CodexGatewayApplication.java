package co.spax.codexgateway;

import android.app.Application;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;

public final class CodexGatewayApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        if (FirebaseApp.getApps(this).isEmpty() && firebaseConfigured()) {
            FirebaseOptions options = new FirebaseOptions.Builder()
                    .setApplicationId(BuildConfig.FIREBASE_APPLICATION_ID)
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .build();
            FirebaseApp.initializeApp(this, options);
        }
        GatewayNotifications.createChannel(this);
    }

    public static boolean firebaseConfigured() {
        return !BuildConfig.FIREBASE_APPLICATION_ID.isBlank()
                && !BuildConfig.FIREBASE_PROJECT_ID.isBlank()
                && !BuildConfig.FIREBASE_API_KEY.isBlank()
                && !BuildConfig.FIREBASE_PROJECT_ID.equals("replace-me");
    }
}

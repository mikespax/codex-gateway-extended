package co.spax.codexgateway;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends AppCompatActivity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private DeviceCredentialsStore credentialsStore;
    private EditText gatewayUrl;
    private EditText username;
    private EditText password;
    private TextView status;
    private ProgressBar progress;
    private Button connect;
    private Button disconnect;
    private boolean busy;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        credentialsStore = new DeviceCredentialsStore(this);
        setContentView(createContent());
        requestNotificationPermission();
        renderStatus();
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private View createContent() {
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(padding, padding, padding, padding);

        TextView title = new TextView(this);
        title.setText("Codex Gateway Companion");
        title.setTextSize(24);
        layout.addView(title);

        TextView explanation = new TextView(this);
        explanation.setText("Connect once to receive turn-completion notifications and reply inline.");
        explanation.setPadding(0, padding / 2, 0, padding);
        layout.addView(explanation);

        gatewayUrl = field("Gateway URL", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        gatewayUrl.setText("https://codex.spax.co");
        username = field("Gateway username", InputType.TYPE_CLASS_TEXT);
        password = field("Gateway password", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        layout.addView(gatewayUrl);
        layout.addView(username);
        layout.addView(password);

        connect = new Button(this);
        connect.setText("Connect this phone");
        connect.setOnClickListener(view -> connectDevice());
        layout.addView(connect);

        disconnect = new Button(this);
        disconnect.setText("Disconnect this phone");
        disconnect.setOnClickListener(view -> disconnectDevice());
        layout.addView(disconnect);

        progress = new ProgressBar(this);
        progress.setVisibility(View.GONE);
        layout.addView(progress);

        status = new TextView(this);
        status.setPadding(0, padding, 0, 0);
        layout.addView(status);
        return layout;
    }

    private EditText field(String hint, int inputType) {
        EditText field = new EditText(this);
        field.setHint(hint);
        field.setInputType(inputType);
        field.setSingleLine(true);
        return field;
    }

    private void connectDevice() {
        if (!CodexGatewayApplication.firebaseConfigured()) {
            status.setText("This APK was built without Firebase project values.");
            return;
        }
        setBusy(true);
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful() || task.getResult() == null) {
                setBusy(false);
                status.setText("Unable to obtain a Firebase device token.");
                return;
            }
            String fcmToken = task.getResult();
            executor.execute(() -> {
                try {
                    String deviceName = Build.MANUFACTURER + " " + Build.MODEL + " ("
                            + Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID) + ")";
                    GatewayApiClient.Registration registration = GatewayApiClient.loginAndRegister(
                            gatewayUrl.getText().toString(),
                            username.getText().toString(),
                            password.getText().toString(),
                            fcmToken,
                            deviceName);
                    credentialsStore.save(registration.baseUrl, registration.deviceId, registration.deviceToken);
                    runOnUiThread(() -> {
                        password.setText("");
                        setBusy(false);
                        status.setText(registration.firebaseConfigured
                                ? "Connected. Inline replies are ready."
                                : "Phone registered, but the Gateway Firebase credential is not installed yet.");
                    });
                } catch (Exception error) {
                    runOnUiThread(() -> {
                        setBusy(false);
                        status.setText("Connection failed: " + safeMessage(error));
                    });
                }
            });
        });
    }

    private void setBusy(boolean busy) {
        this.busy = busy;
        progress.setVisibility(busy ? View.VISIBLE : View.GONE);
        updateActionButtons();
    }

    private void disconnectDevice() {
        DeviceCredentialsStore.Credentials credentials = credentialsStore.load();
        if (credentials == null) {
            renderStatus();
            return;
        }
        setBusy(true);
        executor.execute(() -> {
            try {
                GatewayApiClient.revoke(credentials);
                credentialsStore.clear();
                runOnUiThread(() -> {
                    setBusy(false);
                    renderStatus();
                });
            } catch (GatewayApiClient.GatewayRequestException error) {
                if (error.status == 401) {
                    credentialsStore.clear();
                    runOnUiThread(() -> {
                        setBusy(false);
                        renderStatus();
                    });
                    return;
                }
                showDisconnectFailure(error);
            } catch (Exception error) {
                showDisconnectFailure(error);
            }
        });
    }

    private void showDisconnectFailure(Exception error) {
        runOnUiThread(() -> {
            setBusy(false);
            status.setText("Could not revoke this phone: " + safeMessage(error));
        });
    }

    private void renderStatus() {
        DeviceCredentialsStore.Credentials credentials = credentialsStore.load();
        status.setText(credentials == null
                ? "Not connected."
                : "Connected to " + credentials.baseUrl + " as device " + credentials.deviceId + ".");
        updateActionButtons();
    }

    private void updateActionButtons() {
        boolean connected = credentialsStore.load() != null;
        connect.setEnabled(!busy && !connected);
        disconnect.setEnabled(!busy && connected);
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1001);
        }
    }

    private static String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }
}

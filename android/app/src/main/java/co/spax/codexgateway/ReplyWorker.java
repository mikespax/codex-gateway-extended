package co.spax.codexgateway;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Data;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public final class ReplyWorker extends Worker {
    private static final String NOTIFICATION_KEY = "notification_key";
    private static final String NOTIFICATION_ID = "notification_id";
    private static final String TEXT = "text";
    private static final String CLIENT_MESSAGE_ID = "client_message_id";

    public ReplyWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    @NonNull
    @Override
    public Result doWork() {
        int notificationId = getInputData().getInt(NOTIFICATION_ID, 0);
        DeviceCredentialsStore.Credentials credentials =
                new DeviceCredentialsStore(getApplicationContext()).load();
        if (credentials == null) {
            GatewayNotifications.showReplyState(
                    getApplicationContext(), notificationId, "Reconnect the companion app.", true);
            return Result.failure();
        }
        try {
            GatewayApiClient.sendReply(
                    credentials,
                    required(NOTIFICATION_KEY),
                    required(TEXT),
                    required(CLIENT_MESSAGE_ID));
            GatewayNotifications.showReplyState(
                    getApplicationContext(), notificationId, "Reply sent. Codex is continuing.", false);
            return Result.success();
        } catch (GatewayApiClient.GatewayRequestException error) {
            if (error.status == 401 || error.status == 404 || error.status == 409) {
                GatewayNotifications.showReplyState(
                        getApplicationContext(), notificationId, error.getMessage(), true);
                return Result.failure();
            }
            return retryOrFail(notificationId, error);
        } catch (Exception error) {
            return retryOrFail(notificationId, error);
        }
    }

    private Result retryOrFail(int notificationId, Exception error) {
        if (getRunAttemptCount() < 5) return Result.retry();
        String message = error.getMessage() == null ? "Network request failed" : error.getMessage();
        GatewayNotifications.showReplyState(getApplicationContext(), notificationId, message, true);
        return Result.failure();
    }

    private String required(String key) {
        String value = getInputData().getString(key);
        if (value == null || value.isBlank()) throw new IllegalArgumentException("Missing " + key);
        return value;
    }

    public static void enqueue(
            Context context,
            String notificationKey,
            int notificationId,
            String text,
            String clientMessageId) {
        Data input = new Data.Builder()
                .putString(NOTIFICATION_KEY, notificationKey)
                .putInt(NOTIFICATION_ID, notificationId)
                .putString(TEXT, text)
                .putString(CLIENT_MESSAGE_ID, clientMessageId)
                .build();
        WorkManager.getInstance(context).enqueue(
                new OneTimeWorkRequest.Builder(ReplyWorker.class).setInputData(input).build());
    }
}

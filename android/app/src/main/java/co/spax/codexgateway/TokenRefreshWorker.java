package co.spax.codexgateway;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Data;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public final class TokenRefreshWorker extends Worker {
    private static final String FCM_TOKEN = "fcm_token";

    public TokenRefreshWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    @NonNull
    @Override
    public Result doWork() {
        DeviceCredentialsStore.Credentials credentials =
                new DeviceCredentialsStore(getApplicationContext()).load();
        String token = getInputData().getString(FCM_TOKEN);
        if (credentials == null || token == null || token.isBlank()) return Result.success();
        try {
            GatewayApiClient.updateFcmToken(credentials, token);
            return Result.success();
        } catch (GatewayApiClient.GatewayRequestException error) {
            return error.status == 401 ? Result.failure() : Result.retry();
        } catch (Exception error) {
            return getRunAttemptCount() < 5 ? Result.retry() : Result.failure();
        }
    }

    public static void enqueue(Context context, String token) {
        Data input = new Data.Builder().putString(FCM_TOKEN, token).build();
        WorkManager.getInstance(context).enqueue(
                new OneTimeWorkRequest.Builder(TokenRefreshWorker.class).setInputData(input).build());
    }
}

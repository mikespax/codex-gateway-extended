package co.spax.codexgateway;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import androidx.core.app.RemoteInput;
import java.util.UUID;

public final class InlineReplyReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        CharSequence reply = results == null
                ? null
                : results.getCharSequence(GatewayNotifications.REPLY_RESULT_KEY);
        String notificationKey = intent.getStringExtra(GatewayNotifications.EXTRA_NOTIFICATION_KEY);
        int notificationId = intent.getIntExtra(GatewayNotifications.EXTRA_NOTIFICATION_ID, 0);
        if (reply == null || reply.toString().trim().isEmpty() || notificationKey == null) return;
        if (new DeviceCredentialsStore(context).load() == null) {
            GatewayNotifications.showReplyState(
                    context,
                    notificationId,
                    "Open the companion app and reconnect this phone.",
                    true);
            return;
        }
        GatewayNotifications.showReplyState(context, notificationId, "Sending reply…", false);
        ReplyWorker.enqueue(
                context,
                notificationKey,
                notificationId,
                reply.toString().trim(),
                UUID.randomUUID().toString());
    }
}

package co.spax.codexgateway;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public final class GatewayMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        if (!"codex_gateway_notification".equals(data.get("type"))) return;
        String notificationKey = value(data, "notificationKey");
        String title = value(data, "title");
        String body = value(data, "body");
        if (notificationKey.isBlank() || title.isBlank()) return;
        GatewayNotifications.show(
                this,
                notificationKey,
                title,
                body,
                "true".equals(data.get("replyAllowed")),
                value(data, "hostId"),
                value(data, "projectId"),
                value(data, "threadId"));
    }

    @Override
    public void onNewToken(String token) {
        TokenRefreshWorker.enqueue(this, token);
    }

    private static String value(Map<String, String> data, String key) {
        String value = data.get(key);
        return value == null ? "" : value;
    }
}

package co.spax.codexgateway;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;

public final class GatewayNotifications {
    public static final String CHANNEL_ID = "codex_gateway_turns";
    public static final String REPLY_RESULT_KEY = "codex_gateway_inline_reply";
    public static final String EXTRA_NOTIFICATION_KEY = "notification_key";
    public static final String EXTRA_NOTIFICATION_ID = "notification_id";

    private GatewayNotifications() {}

    public static void createChannel(Context context) {
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Codex turn completion",
                NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Completion and input notifications from Codex Gateway");
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(channel);
    }

    public static void show(
            Context context,
            String notificationKey,
            String title,
            String body,
            boolean replyAllowed,
            String hostId,
            String projectId,
            String threadId) {
        int notificationId = notificationId(notificationKey);
        Intent replyIntent = new Intent(context, InlineReplyReceiver.class)
                .setAction("co.spax.codexgateway.REPLY")
                .setData(Uri.parse("codex-gateway://reply/" + Uri.encode(notificationKey)))
                .putExtra(EXTRA_NOTIFICATION_KEY, notificationKey)
                .putExtra(EXTRA_NOTIFICATION_ID, notificationId);
        PendingIntent replyPendingIntent = PendingIntent.getBroadcast(
                context,
                notificationId,
                replyIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
        RemoteInput remoteInput = new RemoteInput.Builder(REPLY_RESULT_KEY)
                .setLabel("Continue this Codex thread")
                .build();
        NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(
                android.R.drawable.ic_menu_send,
                "Reply",
                replyPendingIntent)
                .addRemoteInput(remoteInput)
                .setAllowGeneratedReplies(false)
                .build();

        DeviceCredentialsStore.Credentials credentials = new DeviceCredentialsStore(context).load();
        PendingIntent openPendingIntent = null;
        if (credentials != null) {
            String route = credentials.baseUrl + "/?hostId=" + Uri.encode(hostId)
                    + "&projectId=" + Uri.encode(projectId)
                    + "&threadId=" + Uri.encode(threadId);
            Intent openIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(route));
            openPendingIntent = PendingIntent.getActivity(
                    context,
                    notificationId,
                    openIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }

        Notification publicVersion = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle("Codex Gateway")
                .setContentText("A Codex turn needs your attention")
                .build();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(publicVersion)
                .setAutoCancel(true)
                .setOnlyAlertOnce(false);
        if (replyAllowed) builder.addAction(replyAction);
        if (openPendingIntent != null) builder.setContentIntent(openPendingIntent);
        notify(context, notificationId, builder.build());
    }

    public static void showReplyState(Context context, int notificationId, String text, boolean error) {
        Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(error
                        ? android.R.drawable.stat_notify_error
                        : android.R.drawable.stat_sys_upload_done)
                .setContentTitle(error ? "Codex reply failed" : "Codex reply")
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setPriority(error ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_LOW)
                .setOnlyAlertOnce(true)
                .setAutoCancel(true)
                .build();
        notify(context, notificationId, notification);
    }

    private static void notify(Context context, int id, Notification notification) {
        if (ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) return;
        NotificationManagerCompat.from(context).notify(id, notification);
    }

    private static int notificationId(String key) {
        int hash = key.hashCode();
        return hash == Integer.MIN_VALUE ? 0 : Math.abs(hash);
    }
}

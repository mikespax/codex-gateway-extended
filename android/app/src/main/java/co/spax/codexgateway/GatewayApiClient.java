package co.spax.codexgateway;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public final class GatewayApiClient {
    private static final int TIMEOUT_MS = 15_000;

    private GatewayApiClient() {}

    public static Registration loginAndRegister(
            String baseUrl,
            String username,
            String password,
            String fcmToken,
            String deviceName) throws Exception {
        String normalizedBaseUrl = normalizeBaseUrl(baseUrl);
        JSONObject login = post(
                normalizedBaseUrl + "/api/auth/login",
                null,
                new JSONObject().put("username", username).put("password", password));
        String sessionToken = requiredString(login, "token");
        JSONObject registration = post(
                normalizedBaseUrl + "/api/android/devices",
                "Bearer " + sessionToken,
                new JSONObject().put("name", deviceName).put("fcmToken", fcmToken));
        return new Registration(
                normalizedBaseUrl,
                requiredString(registration, "id"),
                requiredString(registration, "deviceToken"),
                registration.optBoolean("firebaseConfigured", false));
    }

    public static void sendReply(
            DeviceCredentialsStore.Credentials credentials,
            String notificationKey,
            String text,
            String clientMessageId) throws Exception {
        post(
                credentials.baseUrl + "/api/android/device/reply",
                "Device " + credentials.deviceToken,
                new JSONObject()
                        .put("notificationKey", notificationKey)
                        .put("text", text)
                        .put("clientMessageId", clientMessageId));
    }

    public static void updateFcmToken(
            DeviceCredentialsStore.Credentials credentials,
            String fcmToken) throws Exception {
        post(
                credentials.baseUrl + "/api/android/device/token",
                "Device " + credentials.deviceToken,
                new JSONObject().put("fcmToken", fcmToken));
    }

    public static void revoke(DeviceCredentialsStore.Credentials credentials) throws Exception {
        post(
                credentials.baseUrl + "/api/android/device/revoke",
                "Device " + credentials.deviceToken,
                new JSONObject());
    }

    private static JSONObject post(String urlText, String authorization, JSONObject payload) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlText).openConnection();
        connection.setConnectTimeout(TIMEOUT_MS);
        connection.setReadTimeout(TIMEOUT_MS);
        connection.setRequestMethod("POST");
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setRequestProperty("Accept", "application/json");
        if (authorization != null) connection.setRequestProperty("Authorization", authorization);
        connection.setDoOutput(true);
        byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(body.length);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(body);
        }
        int status = connection.getResponseCode();
        String responseBody = read(status >= 200 && status < 300
                ? connection.getInputStream()
                : connection.getErrorStream());
        JSONObject response = responseBody.isBlank() ? new JSONObject() : new JSONObject(responseBody);
        if (status < 200 || status >= 300) {
            throw new GatewayRequestException(status, response.optString("message", "Gateway request failed"));
        }
        return response;
    }

    private static String read(InputStream input) throws Exception {
        if (input == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private static String normalizeBaseUrl(String value) {
        String normalized = value.trim().replaceAll("/+$", "");
        if (!normalized.startsWith("https://")) {
            throw new IllegalArgumentException("Gateway URL must use HTTPS");
        }
        return normalized;
    }

    private static String requiredString(JSONObject object, String key) {
        String value = object.optString(key, "").trim();
        if (value.isEmpty()) throw new IllegalArgumentException("Gateway response is missing " + key);
        return value;
    }

    public static final class Registration {
        public final String baseUrl;
        public final String deviceId;
        public final String deviceToken;
        public final boolean firebaseConfigured;

        Registration(String baseUrl, String deviceId, String deviceToken, boolean firebaseConfigured) {
            this.baseUrl = baseUrl;
            this.deviceId = deviceId;
            this.deviceToken = deviceToken;
            this.firebaseConfigured = firebaseConfigured;
        }
    }

    public static final class GatewayRequestException extends Exception {
        public final int status;

        GatewayRequestException(int status, String message) {
            super(message);
            this.status = status;
        }
    }
}

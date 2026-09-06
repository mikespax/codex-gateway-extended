package co.spax.codexgateway;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class DeviceCredentialsStore {
    private static final String KEY_ALIAS = "codex-gateway-device-credentials";
    private static final String PREFS = "codex_gateway_device";
    private static final String BASE_URL = "base_url";
    private static final String DEVICE_ID = "device_id";
    private static final String DEVICE_TOKEN = "device_token";

    private final SharedPreferences preferences;

    public DeviceCredentialsStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized void save(String baseUrl, String deviceId, String deviceToken) throws Exception {
        preferences.edit()
                .putString(BASE_URL, encrypt(baseUrl))
                .putString(DEVICE_ID, encrypt(deviceId))
                .putString(DEVICE_TOKEN, encrypt(deviceToken))
                .apply();
    }

    public synchronized Credentials load() {
        try {
            String baseUrl = preferences.getString(BASE_URL, null);
            String deviceId = preferences.getString(DEVICE_ID, null);
            String deviceToken = preferences.getString(DEVICE_TOKEN, null);
            if (baseUrl == null || deviceId == null || deviceToken == null) return null;
            return new Credentials(decrypt(baseUrl), decrypt(deviceId), decrypt(deviceToken));
        } catch (Exception error) {
            clear();
            return null;
        }
    }

    public synchronized void clear() {
        preferences.edit().clear().apply();
    }

    private String encrypt(String plaintext) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, secretKey());
        byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        ByteBuffer output = ByteBuffer.allocate(4 + iv.length + ciphertext.length);
        output.putInt(iv.length).put(iv).put(ciphertext);
        return Base64.encodeToString(output.array(), Base64.NO_WRAP);
    }

    private String decrypt(String encoded) throws Exception {
        ByteBuffer input = ByteBuffer.wrap(Base64.decode(encoded, Base64.NO_WRAP));
        int ivLength = input.getInt();
        if (ivLength < 12 || ivLength > 16 || input.remaining() <= ivLength) {
            throw new IllegalArgumentException("Invalid encrypted credentials");
        }
        byte[] iv = new byte[ivLength];
        input.get(iv);
        byte[] ciphertext = new byte[input.remaining()];
        input.get(ciphertext);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
    }

    private SecretKey secretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        KeyStore.Entry existing = keyStore.getEntry(KEY_ALIAS, null);
        if (existing instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) existing).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }

    public static final class Credentials {
        public final String baseUrl;
        public final String deviceId;
        public final String deviceToken;

        Credentials(String baseUrl, String deviceId, String deviceToken) {
            this.baseUrl = baseUrl;
            this.deviceId = deviceId;
            this.deviceToken = deviceToken;
        }
    }
}

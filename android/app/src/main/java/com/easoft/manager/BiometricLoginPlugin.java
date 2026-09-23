package com.easoft.manager;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

@CapacitorPlugin(name = "BiometricLogin")
public class BiometricLoginPlugin extends Plugin {
    private static final String ALIAS = "ea_soft_biometric_login_v1";
    private boolean busy = false;

    private File credentialFile() {
        return new File(getContext().getNoBackupFilesDir(), "biometric-login.json");
    }

    private KeyStore keyStore() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        return store;
    }

    private int availability() {
        return BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
    }

    @PluginMethod
    public void status(PluginCall call) {
        try {
            int available = availability();
            JSObject result = new JSObject();
            result.put("available", available == BiometricManager.BIOMETRIC_SUCCESS);
            result.put("enabled", credentialFile().exists() && keyStore().containsAlias(ALIAS));
            result.put("message", available == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
                ? "Add a fingerprint in Android Settings to enable biometric sign-in."
                : "Fingerprint sign-in is unavailable. You can still use your password.");
            call.resolve(result);
        } catch (Exception error) { call.reject("Could not check fingerprint availability."); }
    }

    private void erase() throws Exception {
        if (credentialFile().exists() && !credentialFile().delete()) throw new Exception("Could not remove saved credentials");
        keyStore().deleteEntry(ALIAS);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (busy) { call.reject("Finish the fingerprint prompt first."); return; }
            try { erase(); call.resolve(); }
            catch (Exception error) { call.reject("Could not disable fingerprint sign-in."); }
        });
    }

    @PluginMethod
    public void save(PluginCall call) {
        String email = call.getString("email");
        String password = call.getString("password");
        String apiUrl = call.getString("apiUrl");
        if (email == null || password == null || apiUrl == null || password.isEmpty()) {
            call.reject("Sign in with your password first."); return;
        }
        JSObject credentials = new JSObject();
        credentials.put("email", email);
        credentials.put("password", password);
        credentials.put("apiUrl", apiUrl);
        authenticate(call, credentials.toString());
    }

    @PluginMethod
    public void unlock(PluginCall call) { authenticate(call, null); }

    private void authenticate(PluginCall call, String plaintext) {
        getActivity().runOnUiThread(() -> {
            if (busy) { call.reject("A fingerprint prompt is already open."); return; }
            if (availability() != BiometricManager.BIOMETRIC_SUCCESS) {
                call.reject("Fingerprint is unavailable. Use your account password."); return;
            }
            busy = true;
            try {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                final byte[] encrypted;
                if (plaintext != null) {
                    erase();
                    KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                    KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setUserAuthenticationRequired(true)
                        .setUserAuthenticationValidityDurationSeconds(-1);
                    if (Build.VERSION.SDK_INT >= 24) builder.setInvalidatedByBiometricEnrollment(true);
                    generator.init(builder.build());
                    cipher.init(Cipher.ENCRYPT_MODE, generator.generateKey());
                    encrypted = null;
                } else {
                    byte[] bytes;
                    try (FileInputStream input = new FileInputStream(credentialFile())) {
                        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
                        byte[] buffer = new byte[1024];
                        int count;
                        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                        bytes = output.toByteArray();
                    }
                    JSONObject stored = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
                    encrypted = Base64.decode(stored.getString("ciphertext"), Base64.NO_WRAP);
                    SecretKey key = (SecretKey) keyStore().getKey(ALIAS, null);
                    cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128,
                        Base64.decode(stored.getString("iv"), Base64.NO_WRAP)));
                }
                BiometricPrompt prompt = new BiometricPrompt((FragmentActivity) getActivity(),
                    ContextCompat.getMainExecutor(getContext()), new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationError(int code, @NonNull CharSequence message) {
                        busy = false;
                        call.reject(message.toString());
                    }

                    @Override
                    public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                        try {
                            Cipher approved = result.getCryptoObject() == null ? null : result.getCryptoObject().getCipher();
                            if (approved == null) throw new Exception("Missing authenticated cipher");
                            if (plaintext != null) {
                                byte[] ciphertext = approved.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
                                JSONObject stored = new JSONObject();
                                stored.put("iv", Base64.encodeToString(approved.getIV(), Base64.NO_WRAP));
                                stored.put("ciphertext", Base64.encodeToString(ciphertext, Base64.NO_WRAP));
                                try (FileOutputStream output = new FileOutputStream(credentialFile())) {
                                    output.write(stored.toString().getBytes(StandardCharsets.UTF_8));
                                }
                                call.resolve();
                            } else {
                                String decoded = new String(approved.doFinal(encrypted), StandardCharsets.UTF_8);
                                call.resolve(new JSObject(decoded));
                            }
                        } catch (Exception error) {
                            try { erase(); } catch (Exception ignored) {}
                            call.reject("Fingerprint sign-in needs to be enabled again. Use your password.");
                        } finally { busy = false; }
                    }
                });
                prompt.authenticate(new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(plaintext == null ? "Sign in to EA-Soft Manager" : "Enable fingerprint sign-in")
                    .setSubtitle("Use your fingerprint or another enrolled strong biometric")
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .setNegativeButtonText("Use password")
                    .build(), new BiometricPrompt.CryptoObject(cipher));
            } catch (Exception error) {
                busy = false;
                try { erase(); } catch (Exception ignored) {}
                call.reject("Fingerprint sign-in needs to be enabled again. Use your password.");
            }
        });
    }
}

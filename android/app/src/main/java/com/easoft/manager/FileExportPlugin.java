package com.easoft.manager;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "FileExport")
public class FileExportPlugin extends Plugin {
    @PluginMethod
    public void exportFile(PluginCall call) {
        String filename = call.getString("filename");
        String text = call.getString("text");
        String mimeType = call.getString("mimeType", "text/plain");
        if (filename == null || !filename.matches("[A-Za-z0-9_-]+\\.(csv|json)") || text == null) {
            call.reject("Invalid export file.");
            return;
        }

        try {
            File directory = new File(getContext().getCacheDir(), "exports");
            if (!directory.exists() && !directory.mkdirs()) {
                throw new IOException("Could not create export directory.");
            }
            File file = new File(directory, filename);
            try (FileOutputStream output = new FileOutputStream(file)) {
                output.write(text.getBytes(StandardCharsets.UTF_8));
            }

            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType(mimeType);
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            intent.setClipData(ClipData.newRawUri(filename, uri));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().runOnUiThread(() -> {
                try {
                    getActivity().startActivity(Intent.createChooser(intent, "Save or share file"));
                    call.resolve();
                } catch (Exception error) {
                    call.reject("Could not open file sharing.", error);
                }
            });
        } catch (Exception error) {
            call.reject("Could not export file.", error);
        }
    }
}

package com.expresat.native_app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.util.Log;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.*;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.common.util.concurrent.ListenableFuture;

import java.io.File;
import java.nio.ByteBuffer;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;

/**
 * MainActivity - Android shell bridging CameraX to native C++ inference engine.
 */
public class MainActivity extends AppCompatActivity {

    private static final String TAG = "ExpresatNative";
    private static final int CAMERA_PERMISSION_CODE = 1001;

    static {
        System.loadLibrary("expresat_native");
    }

    private native boolean nativeInit(String modelPath);
    private native void    nativeDestroy();
    private native void    nativeSubmitFrame(byte[] yuvData, int width, int height);
    private native String  nativeGetResult();

    private TextView tvPrediction;
    private TextView tvMetrics;
    private boolean  nativeReady = false;

    private final android.os.Handler uiHandler = new android.os.Handler(
        android.os.Looper.getMainLooper());
    private final Runnable pollRunnable = new Runnable() {
        @Override public void run() {
            if (nativeReady) {
                String json = nativeGetResult();
                updateUiFromJson(json);
            }
            uiHandler.postDelayed(this, 100); // 10 Hz UI refresh rate
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        tvPrediction = findViewById(R.id.tvPrediction);
        tvMetrics    = findViewById(R.id.tvMetrics);

        if (hasCameraPermission()) {
            startNativeEngine();
        } else {
            requestCameraPermission();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        uiHandler.removeCallbacks(pollRunnable);
        if (nativeReady) {
            nativeDestroy();
            nativeReady = false;
        }
    }

    private void startNativeEngine() {
        String modelPath = extractModelIfNeeded();
        if (modelPath == null) {
            Log.e(TAG, "Failed to extract ONNX model");
            tvPrediction.setText("Error: model not found");
            return;
        }

        boolean ok = nativeInit(modelPath);
        if (!ok) {
            Log.e(TAG, "nativeInit failed");
            tvPrediction.setText("Error: inference engine");
            return;
        }

        nativeReady = true;
        Log.i(TAG, "Native engine initialized: " + modelPath);

        startCamera();
        uiHandler.post(pollRunnable);
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> cameraProviderFuture =
            ProcessCameraProvider.getInstance(this);

        cameraProviderFuture.addListener(() -> {
            try {
                ProcessCameraProvider cameraProvider = cameraProviderFuture.get();
                bindCamera(cameraProvider);
            } catch (ExecutionException | InterruptedException e) {
                Log.e(TAG, "Error starting CameraX: " + e.getMessage());
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void bindCamera(ProcessCameraProvider cameraProvider) {
        ImageAnalysis analysis = new ImageAnalysis.Builder()
            .setTargetResolution(new android.util.Size(640, 480))
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
            .build();

        analysis.setAnalyzer(
            Executors.newSingleThreadExecutor(),
            image -> {
                if (!nativeReady) {
                    image.close();
                    return;
                }

                // Convert YUV_420_888 to NV21 byte array for C++ core
                ByteBuffer yBuffer = image.getPlanes()[0].getBuffer();
                ByteBuffer uBuffer = image.getPlanes()[1].getBuffer();
                ByteBuffer vBuffer = image.getPlanes()[2].getBuffer();

                int ySize = yBuffer.remaining();
                int uSize = uBuffer.remaining();
                int vSize = vBuffer.remaining();

                byte[] nv21 = new byte[ySize + uSize + vSize];
                yBuffer.get(nv21, 0, ySize);
                vBuffer.get(nv21, ySize, vSize);
                uBuffer.get(nv21, ySize + vSize, uSize);

                nativeSubmitFrame(nv21, image.getWidth(), image.getHeight());
                image.close();
            }
        );

        CameraSelector cameraSelector = CameraSelector.DEFAULT_FRONT_CAMERA;

        try {
            cameraProvider.unbindAll();
            cameraProvider.bindToLifecycle(this, cameraSelector, analysis);
            Log.i(TAG, "CameraX bound (front camera)");
        } catch (Exception e) {
            Log.e(TAG, "Error binding camera: " + e.getMessage());
        }
    }

    private void updateUiFromJson(String json) {
        String label = extractJsonString(json, "label");
        String confStr = extractJsonString(json, "confidence");
        String fpsStr  = extractJsonString(json, "fps");

        float confidence = confStr.isEmpty() ? 0f : Float.parseFloat(confStr);
        float fps        = fpsStr.isEmpty()  ? 0f : Float.parseFloat(fpsStr);

        if (label != null && !label.isEmpty()) {
            tvPrediction.setText(label.toUpperCase());
        } else {
            tvPrediction.setText("-");
        }
        tvMetrics.setText(String.format(
            "Confidence: %.1f%%  |  FPS: %.1f", confidence * 100, fps));
    }

    private String extractJsonString(String json, String key) {
        try {
            String search = "\"" + key + "\":";
            int start = json.indexOf(search);
            if (start < 0) return "";
            start += search.length();
            if (json.charAt(start) == '"') {
                start++;
                int end = json.indexOf('"', start);
                return json.substring(start, end);
            } else {
                int end = json.indexOf(',', start);
                if (end < 0) end = json.indexOf('}', start);
                return json.substring(start, end).trim();
            }
        } catch (Exception e) { return ""; }
    }

    private boolean hasCameraPermission() {
        return ContextCompat.checkSelfPermission(
            this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestCameraPermission() {
        ActivityCompat.requestPermissions(
            this,
            new String[]{Manifest.permission.CAMERA},
            CAMERA_PERMISSION_CODE
        );
    }

    @Override
    public void onRequestPermissionsResult(int requestCode,
        @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CAMERA_PERMISSION_CODE &&
            grantResults.length > 0 &&
            grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startNativeEngine();
        } else {
            tvPrediction.setText("Camera permission denied");
        }
    }

    private String extractModelIfNeeded() {
        File modelFile = new File(getFilesDir(), "expresat_gru_float32.onnx");
        if (modelFile.exists()) return modelFile.getAbsolutePath();

        try {
            java.io.InputStream is =
                getAssets().open("expresat_gru_float32.onnx");
            java.io.FileOutputStream os = new java.io.FileOutputStream(modelFile);
            byte[] buf = new byte[4096];
            int n;
            while ((n = is.read(buf)) > 0) os.write(buf, 0, n);
            is.close(); os.close();
            Log.i(TAG, "Model extracted to: " + modelFile.getAbsolutePath());
            return modelFile.getAbsolutePath();
        } catch (Exception e) {
            Log.e(TAG, "Error extracting model: " + e.getMessage());
            return null;
        }
    }
}

import { AuthService } from './auth_service.js';
import { ApiService } from './api_service.js';
import { MediaPipeEngine } from './mediapipe_engine.js';

document.addEventListener('DOMContentLoaded', async () => {
    // DOM Components
    const authOverlay = document.getElementById('auth-overlay');
    const mainApp = document.getElementById('main-app');
    const authForm = document.getElementById('auth-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const authError = document.getElementById('auth-error');
    const registerBtn = document.getElementById('register-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const wsStatus = document.getElementById('ws-status');
    const translationText = document.getElementById('translation-text');
    
    // Initial Configuration
    const authService = new AuthService();
    // Change to real FastAPI backend URL
    const apiService = new ApiService('ws://127.0.0.1:8000/ws'); 
    let mediaPipeEngine = null;

    /**
     * Authentication Middleware: Checks if a valid session exists when loading the app.
     * Decision: Attempts to get the Supabase session asynchronously. If it fails or doesn't exist,
     * it visually redirects the user to the authentication screen.
     */
    const checkAuth = async () => {
        try {
            const session = await authService.getSession();
            if (session) {
                showApp(session.access_token);
            } else {
                showAuth();
            }
        } catch (error) {
            console.error("Error validando sesión:", error);
            showAuth();
        }
    };

    authService.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            showApp(session.access_token);
        } else if (event === 'SIGNED_OUT') {
            showAuth();
        }
    });

    /**
     * Prepares and shows the main application once the user is authenticated.
     * Actions: Hides the login overlay, starts the WebSocket connection, and starts
     * the MediaPipe engine for sign detection.
     * @param {string} token - JWT Token for the WebSocket connection.
     */
    const showApp = (token) => {
        authOverlay.classList.remove('active');
        authOverlay.classList.add('hidden');
        mainApp.classList.remove('hidden');

        // Start WebSockets
        apiService.connect(token);
        
        // Start MediaPipe if not started
        if (!mediaPipeEngine) {
            const videoEl = document.getElementById('input-video');
            const canvasEl = document.getElementById('output-canvas');
            
            // Adjust canvas internally
            canvasEl.width = 640;
            canvasEl.height = 480;

            mediaPipeEngine = new MediaPipeEngine(videoEl, canvasEl, (landmarks) => {
                // Send data to backend 
                apiService.sendLandmarks(landmarks);
            });
            mediaPipeEngine.start();
        }
    };

    /**
     * Shows the authentication screen and hides the main application.
     */
    const showAuth = () => {
        authOverlay.classList.add('active');
        authOverlay.classList.remove('hidden');
        mainApp.classList.add('hidden');
    };

    // --- UI EVENTS ---
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        authError.classList.add('hidden');
        try {
            await authService.login(emailInput.value, passwordInput.value);
        } catch (error) {
            authError.innerText = error.message;
            authError.classList.remove('hidden');
        }
    });

    registerBtn.addEventListener('click', async () => {
        authError.classList.add('hidden');
        if (!emailInput.value || !passwordInput.value) {
            authError.innerText = "Ingresa email y contraseña para registrarte.";
            authError.classList.remove('hidden');
            return;
        }
        try {
            await authService.register(emailInput.value, passwordInput.value);
            authError.innerText = "Registro exitoso. Revisa tu email para confirmar o inicia sesión.";
            authError.classList.remove('hidden');
            authError.style.color = "var(--success-color)";
        } catch (error) {
            authError.innerText = error.message;
            authError.classList.remove('hidden');
            authError.style.color = "var(--error-color)";
        }
    });

    logoutBtn.addEventListener('click', async () => {
        await authService.logout();
        // Reload to clear states
        window.location.reload(); 
    });

    // --- API EVENTS (WEBSOCKETS) ---
    apiService.onStatusChange((text, className) => {
        wsStatus.innerText = text;
        wsStatus.className = `indicator ${className}`;
    });

    apiService.onMessage((translation) => {
        translationText.innerText = translation;
    });

    // Initialize app by checking session
    checkAuth();
});

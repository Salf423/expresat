import { AuthService } from './auth_service.js';
import { ApiService } from './api_service.js';
import { MediaPipeEngine } from './mediapipe_engine.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Componentes del DOM
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
    
    // Configuración Inicial
    const authService = new AuthService();
    // Cambiar por URL real del backend FastAPI
    const apiService = new ApiService('ws://127.0.0.1:8000/ws'); 
    let mediaPipeEngine = null;

    /**
     * Middleware de Autenticación: Verifica si existe una sesión válida al cargar la aplicación.
     * Decisión: Se intenta obtener la sesión de Supabase de forma asíncrona. Si falla o no existe,
     * se redirige visualmente al usuario a la pantalla de autenticación.
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
     * Prepara y muestra la aplicación principal una vez autenticado el usuario.
     * Acciones: Oculta el overlay de login, inicia la conexión WebSocket y arranca
     * el motor de MediaPipe para la detección de señas.
     * @param {string} token - JWT Token para la conexión WebSocket.
     */
    const showApp = (token) => {
        authOverlay.classList.remove('active');
        authOverlay.classList.add('hidden');
        mainApp.classList.remove('hidden');

        // Iniciar WebSockets
        apiService.connect(token);
        
        // Iniciar MediaPipe si no ha iniciado
        if (!mediaPipeEngine) {
            const videoEl = document.getElementById('input-video');
            const canvasEl = document.getElementById('output-canvas');
            
            // Ajustar canvas internamente
            canvasEl.width = 640;
            canvasEl.height = 480;

            mediaPipeEngine = new MediaPipeEngine(videoEl, canvasEl, (landmarks) => {
                // Enviar datos al backend 
                apiService.sendLandmarks(landmarks);
            });
            mediaPipeEngine.start();
        }
    };

    /**
     * Muestra la pantalla de autenticación y oculta la aplicación principal.
     */
    const showAuth = () => {
        authOverlay.classList.add('active');
        authOverlay.classList.remove('hidden');
        mainApp.classList.add('hidden');
    };

    // --- EVENTOS UI ---
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
        // Recargar para limpiar estados
        window.location.reload(); 
    });

    // --- EVENTOS API (WEBSOCKETS) ---
    apiService.onStatusChange((text, className) => {
        wsStatus.innerText = text;
        wsStatus.className = `indicator ${className}`;
    });

    apiService.onMessage((translation) => {
        translationText.innerText = translation;
    });

    // Inicializar app verificando sesión
    checkAuth();
});

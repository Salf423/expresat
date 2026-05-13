// auth_service.js
// Implementa la lógica de Supabase Auth usando el SDK

// Debes reemplazar esto con tus credenciales de Supabase
const SUPABASE_URL = 'https://ecmeqjyuedwrrcoenpij.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjbWVxanl1ZWR3cnJjb2VucGlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NDExNTAsImV4cCI6MjA5NDAxNzE1MH0.uHm8HqX3O8LGRBkLbOsY1eKcxin1pQgdJZWe5ssL_uk'; // Tu Anon Key

export const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export class AuthService {
    /**
     * Inicializa el servicio de autenticación.
     * Verifica si el SDK de Supabase está cargado globalmente (inyectado vía script en el HTML).
     * Esta decisión se toma para evitar la complejidad de un bundler en esta etapa del prototipo.
     */
    constructor() {
        if (!supabase) {
            console.error("Supabase SDK no está cargado. Revisa la etiqueta <script> en index.html o las credenciales.");
        }
    }

    /**
     * Obtiene la sesión actual del usuario de forma asíncrona.
     * Se utiliza para verificar si el usuario ya está logueado al cargar la página.
     * Maneja errores lanzando una excepción para que el llamador pueda reaccionar (ej. redirigir al login).
     */
    async getSession() {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        return data.session;
    }

    /**
     * Autentica a un usuario mediante email y contraseña.
     * Decisión: Se usa 'signInWithPassword' por ser el método estándar y directo.
     * Devuelve los datos del usuario si la operación es exitosa.
     */
    async login(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });
        if (error) throw error;
        return data;
    }

    /**
     * Registra un nuevo usuario en la plataforma.
     * Supabase maneja automáticamente el envío de correos de confirmación si está configurado.
     * Retorna los datos de registro inicial.
     */
    async register(email, password) {
        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password,
        });
        if (error) throw error;
        return data;
    }

    /**
     * Cierra la sesión activa del usuario.
     * Es una operación global que invalida el token actual en el cliente.
     */
    async logout() {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
    }

    /**
     * Suscribe un callback a los cambios en el estado de autenticación.
     * Esta es la pieza clave para la reactividad de la UI (mostrar/ocultar secciones).
     * @param {Function} callback - Función que se ejecuta ante cambios (LOGIN, LOGOUT, etc.)
     */
    onAuthStateChange(callback) {
        return supabase.auth.onAuthStateChange((event, session) => {
            callback(event, session);
        });
    }
}

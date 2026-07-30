// auth_service.js
// Implements Supabase Auth logic using the SDK

// You must replace this with your Supabase credentials
const SUPABASE_URL = 'https://ecmeqjyuedwrrcoenpij.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjbWVxanl1ZWR3cnJjb2VucGlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NDExNTAsImV4cCI6MjA5NDAxNzE1MH0.uHm8HqX3O8LGRBkLbOsY1eKcxin1pQgdJZWe5ssL_uk'; // Your Anon Key

export const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export class AuthService {
    /**
     * Initializes the authentication service.
     * Checks if the Supabase SDK is loaded globally (injected via script in HTML).
     * This decision was made to avoid bundler complexity at this prototype stage.
     */
    constructor() {
        if (!supabase) {
            console.error("Supabase SDK is not loaded. Check the <script> tag in index.html or the credentials.");
        }
    }

    /**
     * Asynchronously gets the current user session.
     * Used to check if the user is already logged in when the page loads.
     * Handles errors by throwing an exception so the caller can react (e.g., redirect to login).
     */
    async getSession() {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        return data.session;
    }

    /**
     * Authenticates a user via email and password.
     * Decision: 'signInWithPassword' is used as it is the standard and direct method.
     * Returns user data if the operation is successful.
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
     * Registers a new user on the platform.
     * Supabase automatically handles sending confirmation emails if configured.
     * Returns initial registration data.
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
     * Closes the active user session.
     * It is a global operation that invalidates the current token on the client.
     */
    async logout() {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
    }

    /**
     * Subscribes a callback to authentication state changes.
     * This is the key piece for UI reactivity (showing/hiding sections).
     * @param {Function} callback - Function executed on changes (LOGIN, LOGOUT, etc.)
     */
    onAuthStateChange(callback) {
        return supabase.auth.onAuthStateChange((event, session) => {
            callback(event, session);
        });
    }
}

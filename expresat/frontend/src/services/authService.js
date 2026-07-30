import { createClient } from '@supabase/supabase-js';

// The anon key is the correct and safe key for all frontend auth operations.
// It is a public key — never use the service_role key in the browser.
// All Supabase Auth methods (login, register, logout, etc.) work with the anon key by design.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
        '[AuthService] Missing Supabase environment variables.\n' +
        'Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in your .env file.'
    );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export class AuthService {
    /**
     * Asynchronously gets the current user session.
     * Returns null if there is no active session (user not logged in).
     */
    async getSession() {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        return data.session;
    }

    /**
     * Authenticates a user via email and password.
     * Returns { user, session } on success.
     */
    async login(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) throw error;
        return data;
    }

    /**
     * Registers a new user on the platform, including their full name.
     * If email confirmation is enabled in Supabase, the session will be null
     * until the user confirms their email.
     */
    async register(email, password, fullName) {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName,
                }
            }
        });
        if (error) throw error;
        return data;
    }

    /**
     * Sends a password recovery email.
     * The user will be redirected to /reset-password after clicking the link.
     */
    async resetPassword(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
    }

    /**
     * Closes the active user session and clears local storage tokens.
     */
    async logout() {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
    }

    /**
     * Subscribes a callback to authentication state changes.
     * Events include: SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED.
     * Returns an unsubscribe function — call it on component unmount to avoid memory leaks.
     */
    onAuthStateChange(callback) {
        return supabase.auth.onAuthStateChange((event, session) => {
            callback(event, session);
        });
    }
}


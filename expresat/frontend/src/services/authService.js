import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config.js';

/**
 * Supabase Auth client initialized only when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 * are configured in src/config.js. In demo mode without credentials, `supabase` is `null`
 * and the app runs client-side without startup errors.
 */
export const supabase = CONFIG.supabaseConfigured
  ? createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey)
  : null;

function requireSupabaseClient() {
  if (!supabase) {
    throw new Error(
      'La autenticación con Supabase no está configurada en este entorno (Modo Demo Local activo). ' +
      'Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en expresat/frontend/.env para habilitar el inicio de sesión.'
    );
  }
  return supabase;
}

export class AuthService {
  /**
   * Returns whether the authentication client is configured.
   */
  isConfigured() {
    return Boolean(supabase);
  }

  /**
   * Fetches the active user session, returning null if none exists or Supabase is unconfigured.
   */
  async getSession() {
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  /**
   * Returns the current JWT access_token if a valid session exists, or null otherwise.
   */
  async getAccessToken() {
    if (!supabase) return null;
    try {
      const session = await this.getSession();
      return session?.access_token || null;
    } catch (err) {
      console.warn('[AuthService] No se pudo recuperar la sesión activa:', err.message);
      return null;
    }
  }

  /**
   * Signs in a user with email and password.
   */
  async login(email, password) {
    const client = requireSupabaseClient();
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  }

  /**
   * Registers a new user account.
   */
  async register(email, password, fullName) {
    const client = requireSupabaseClient();
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });
    if (error) throw error;
    return data;
  }

  /**
   * Sends a password recovery email.
   */
  async resetPassword(email) {
    const client = requireSupabaseClient();
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  }

  /**
   * Signs out the currently active user.
   */
  async logout() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  /**
   * Subscribes a callback to authentication state changes.
   */
  onAuthStateChange(callback) {
    if (!supabase) {
      return {
        data: {
          subscription: {
            unsubscribe: () => { },
          },
        },
      };
    }
    return supabase.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  }
}

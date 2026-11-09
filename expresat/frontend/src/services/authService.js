import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config.js';

/**
 * Cliente Supabase inicializado únicamente cuando VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
 * están configurados con valores válidos en src/config.js.
 * En modo demo sin credenciales de Supabase, `supabase` es `null` y la aplicación
 * funciona 100% en el navegador sin lanzar errores al cargar.
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
   * Indica si el cliente de autenticación está disponible.
   */
  isConfigured() {
    return Boolean(supabase);
  }

  /**
   * Obtiene de forma asíncrona la sesión actual del usuario.
   * Devuelve null si no hay sesión activa o si Supabase no está configurado (Modo Demo).
   */
  async getSession() {
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  /**
   * Obtiene el access_token JWT actual si existe una sesión válida, o null en caso contrario.
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
   * Autentica a un usuario mediante correo y contraseña.
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
   * Registra un nuevo usuario en la plataforma.
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
   * Envía un correo de recuperación de contraseña.
   */
  async resetPassword(email) {
    const client = requireSupabaseClient();
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  }

  /**
   * Cierra la sesión activa del usuario.
   */
  async logout() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  /**
   * Suscribe un callback a los cambios de estado de autenticación.
   */
  onAuthStateChange(callback) {
    if (!supabase) {
      return {
        data: {
          subscription: {
            unsubscribe: () => {},
          },
        },
      };
    }
    return supabase.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  }
}

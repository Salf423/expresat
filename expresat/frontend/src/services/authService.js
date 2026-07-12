import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ecmeqjyuedwrrcoenpij.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjbWVxanl1ZWR3cnJjb2VucGlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NDExNTAsImV4cCI6MjA5NDAxNzE1MH0.uHm8HqX3O8LGRBkLbOsY1eKcxin1pQgdJZWe5ssL_uk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export class AuthService {
    /**
     * Obtiene la sesión actual del usuario de forma asíncrona.
     */
    async getSession() {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        return data.session;
    }

    /**
     * Autentica a un usuario mediante email y contraseña.
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
     * Registra un nuevo usuario en la plataforma, incluyendo su nombre completo.
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
     * Envía un correo de recuperación de contraseña.
     */
    async resetPassword(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
    }

    /**
     * Cierra la sesión activa del usuario.
     */
    async logout() {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
    }

    /**
     * Suscribe un callback a los cambios en el estado de autenticación.
     */
    onAuthStateChange(callback) {
        return supabase.auth.onAuthStateChange((event, session) => {
            callback(event, session);
        });
    }
}

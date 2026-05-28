document.addEventListener('DOMContentLoaded', () => {
    const mobileToggle = document.getElementById('mobile-toggle');
    const navLinks = document.getElementById('nav-links');
    const userAvatar = document.getElementById('user-avatar');
    const dropdownMenu = document.getElementById('dropdown-menu');

    if (mobileToggle && navLinks) {
        mobileToggle.addEventListener('click', () => {
            navLinks.classList.toggle('active');
        });
    }

    if (userAvatar && dropdownMenu) {
        userAvatar.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownMenu.classList.toggle('active');
        });

        // Cerrar al hacer clic fuera
        document.addEventListener('click', (e) => {
            if (!userAvatar.contains(e.target) && !dropdownMenu.contains(e.target)) {
                dropdownMenu.classList.remove('active');
            }
        });
    }

    const loginBtn = document.getElementById('nav-login-btn');
    const authWrapper = document.getElementById('nav-auth-wrapper');
    
    /**
     * Actualiza el estado visual de la barra de navegación según la sesión del usuario.
     * Decisión: Esta función se expone globalmente para ser invocada desde auth_service.js 
     * o app.js cuando el estado de autenticación cambia, desacoplando la lógica de auth de la UI.
     * @param {boolean} isLoggedIn - Indica si hay una sesión activa.
     * @param {string} userLetter - Inicial del usuario para mostrar en el avatar.
     */
    window.updateNavbarAuthState = (isLoggedIn, userLetter = 'U') => {
        if(isLoggedIn) {
            if(loginBtn) loginBtn.style.display = 'none';
            if(authWrapper) authWrapper.style.display = 'block';
            if(userAvatar) userAvatar.innerText = userLetter;
        } else {
            if(loginBtn) loginBtn.style.display = 'inline-flex';
            if(authWrapper) authWrapper.style.display = 'none';
        }
    };
});

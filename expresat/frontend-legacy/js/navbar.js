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

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (!userAvatar.contains(e.target) && !dropdownMenu.contains(e.target)) {
                dropdownMenu.classList.remove('active');
            }
        });
    }

    const loginBtn = document.getElementById('nav-login-btn');
    const authWrapper = document.getElementById('nav-auth-wrapper');
    
    /**
     * Updates the visual state of the navigation bar based on the user session.
     * Decision: This function is exposed globally to be invoked from auth_service.js 
     * or app.js when the authentication state changes, decoupling auth logic from the UI.
     * @param {boolean} isLoggedIn - Indicates if there is an active session.
     * @param {string} userLetter - User initial to display in the avatar.
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

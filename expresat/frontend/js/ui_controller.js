// ui_controller.js
// Maneja Partículas del fondo y animaciones ScrollReveal

document.addEventListener('DOMContentLoaded', () => {
    initParticles();
    initScrollReveal();
});

/**
 * Inicializa el sistema de partículas de fondo en el canvas.
 * Decisión: Se utiliza un canvas 2D para renderizar partículas dinámicas que reaccionan al tamaño de la pantalla.
 * El número de partículas se reduce en dispositivos móviles para optimizar el rendimiento de la CPU/GPU.
 * Incluye un efecto de conexiones (nodos) que aparecen cuando las partículas están cerca.
 */
function initParticles() {
    const canvas = document.getElementById('bg');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;
    
    const particles = [];
    const particleCount = window.innerWidth < 768 ? 40 : 100;

    class Particle {
        constructor() {
            this.x = Math.random() * width;
            this.y = Math.random() * height;
            this.vx = (Math.random() - 0.5) * 0.5;
            this.vy = (Math.random() - 0.5) * 0.5;
            this.size = Math.random() * 2 + 1;
            // Mezcla de cian y purpura
            this.color = Math.random() > 0.5 ? 'rgba(0, 243, 255, 0.4)' : 'rgba(157, 78, 221, 0.4)';
        }
        update() {
            this.x += this.vx;
            this.y += this.vy;
            if (this.x < 0 || this.x > width) this.vx *= -1;
            if (this.y < 0 || this.y > height) this.vy *= -1;
        }
        draw() {
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
    }

    function animate() {
        ctx.clearRect(0, 0, width, height);
        particles.forEach(p => {
            p.update();
            p.draw();
        });
        
        // Dibujar conexiones tenues
        for(let i=0; i<particles.length; i++) {
            for(let j=i+1; j<particles.length; j++) {
                let dx = particles[i].x - particles[j].x;
                let dy = particles[i].y - particles[j].y;
                let dist = Math.sqrt(dx*dx + dy*dy);
                if(dist < 100) {
                    ctx.strokeStyle = `rgba(255,255,255, ${0.1 - dist/1000})`;
                    ctx.lineWidth = 0.5;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.stroke();
                }
            }
        }
        requestAnimationFrame(animate);
    }
    
    animate();

    window.addEventListener('resize', () => {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    });
}

/**
 * Configura las animaciones de revelación al hacer scroll.
 * Decisión: Se utiliza IntersectionObserver por su alta eficiencia en comparación
 * con escuchar el evento 'scroll' directamente. Activa la clase 'active' cuando
 * el elemento entra un 10% en el viewport.
 */
function initScrollReveal() {
    const reveals = document.querySelectorAll('.reveal');
    if (reveals.length === 0) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
            }
        });
    }, { threshold: 0.1 });

    reveals.forEach(el => observer.observe(el));
}

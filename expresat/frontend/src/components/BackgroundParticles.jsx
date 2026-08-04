
import React, { useEffect, useRef } from 'react';
import { useTheme } from '../context/ThemeContext';

const BackgroundParticles = () => {
  const canvasRef = useRef(null);
  const isPausedRef = useRef(false); // Pause state when camera is active
  const animationFrameIdRef = useRef(null);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;

    const isDark = theme === 'dark';
    const particles = [];

    // Reduce particle count to minimize O(N²) connection overhead
    const particleCount = window.innerWidth < 768 ? 25 : 60;

    class Particle {
      constructor() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.size = Math.random() * 2 + 1;

        if (isDark) {
          this.color = Math.random() > 0.5 ? 'rgba(0, 243, 255, 0.4)' : 'rgba(157, 78, 221, 0.4)';
        } else {
          this.color = Math.random() > 0.5 ? 'rgba(0, 180, 216, 0.6)' : 'rgba(114, 9, 183, 0.6)';
        }
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
      // Freeze rendering loop when camera is active or tab is hidden
      if (!isPausedRef.current && !document.hidden) {
        ctx.clearRect(0, 0, width, height);

        particles.forEach(p => {
          p.update();
          p.draw();
        });

        // Particle connections calculation O(N²)
        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const dx = particles[i].x - particles[j].x;
            const dy = particles[i].y - particles[j].y;
            const distSq = dx * dx + dy * dy;
            if (distSq < 14400) { // 120² = 14400
              const dist = Math.sqrt(distSq);
              if (isDark) {
                ctx.strokeStyle = `rgba(255,255,255, ${Math.max(0, 0.4 - dist / 300)})`;
                ctx.lineWidth = 1;
              } else {
                ctx.strokeStyle = `rgba(114, 9, 183, ${Math.max(0, 0.85 - dist / 150)})`;
                ctx.lineWidth = 1.2;
              }
              ctx.beginPath();
              ctx.moveTo(particles[i].x, particles[i].y);
              ctx.lineTo(particles[j].x, particles[j].y);
              ctx.stroke();
            }
          }
        }
      }

      animationFrameIdRef.current = requestAnimationFrame(animate);
    }

    animate();

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // Event listener to pause particles when camera stream starts
    const handleCameraActive = (e) => {
      isPausedRef.current = e.detail === true;
    };
    window.addEventListener('camera-active', handleCameraActive);

    // Pause animation when tab loses focus
    const handleVisibilityChange = () => {
      if (!document.hidden && !animationFrameIdRef.current) {
        animate();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('camera-active', handleCameraActive);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [theme]);

  return (
    <canvas
      id="bg"
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: -1,
        pointerEvents: 'none',
        backgroundColor: 'var(--bg-color)'
      }}
    />
  );
};

export default BackgroundParticles;

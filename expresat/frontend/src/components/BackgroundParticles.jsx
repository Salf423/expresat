
import React, { useEffect, useRef } from 'react';
import { useTheme } from '../context/ThemeContext';

const BackgroundParticles = () => {
  const canvasRef = useRef(null);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;

    const isDark = theme === 'dark';
    const particles = [];
    const particleCount = window.innerWidth < 768 ? 40 : 100;

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

    let animationFrameId;

    function animate() {
      ctx.clearRect(0, 0, width, height);
      particles.forEach(p => {
        p.update();
        p.draw();
      });

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          let dx = particles[i].x - particles[j].x;
          let dy = particles[i].y - particles[j].y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            if (isDark) {
              ctx.strokeStyle = `rgba(255,255,255, ${Math.max(0, 0.4 - dist / 300)})`;
              ctx.lineWidth = 1;
            } else {
              // High-opacity purple lines for strong contrast on white background
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
      animationFrameId = requestAnimationFrame(animate);
    }

    animate();

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
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
        backgroundColor: 'var(--bg)'
      }}
    />
  );
};

export default BackgroundParticles;

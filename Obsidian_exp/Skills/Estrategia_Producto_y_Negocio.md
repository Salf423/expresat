---
title: "Skills Especializadas: Estrategia de Negocio, Producto y Cumplimiento Legal"
description: "Habilidades para estructuración del modelo Open-Core, análisis de mercado TAM/SAM/SOM (INEGI/OMS), pasarelas de pago Stripe, cumplimiento normativo LFPDPPP/GDPR y cálculo de economía unitaria."
version: "2.3.0"
category: "Skills / Negocio & Legal"
status: "Producción"
target_agents: ["business-analyst", "startup-analyst", "legal-advisor"]
recommended_skills:
  - "[[00_Matriz_General_Skills]]"
  - "[[../Plan de negocio de EXPRESAT]]"
---

# 💼 Skills Especializadas: Estrategia de Negocio, Producto y Cumplimiento Legal

> **Navegación:** [[../00_INDICE_MAESTRO|🏠 Índice Maestro]] > [[00_Matriz_General_Skills|🧭 Matriz de Skills]] > **Estrategia, Producto y Negocio**

**ExpresaT** fue concebido bajo una filosofía de **código abierto de impacto social (*Open Core*)**, permitiendo el acceso libre a usuarios individuales, investigadores y escuelas, mientras monetiza mediante planes B2B y B2G (educación pública, salud, ventanillas de atención ciudadana) y cuotas de uso de API para plataformas empresariales.

---

## 🛠️ Catálogo de Skills Instaladas en este Dominio

### 1. `startup-business-analyst-business-case` & `startup-business-analyst-market-opportunity`
- **Ubicación:**
  - `~/.gemini/config/skills/startup-business-analyst-business-case/SKILL.md`
  - `~/.gemini/config/skills/startup-business-analyst-market-opportunity/SKILL.md`
- **Objetivo:** Generación de casos de negocio completos, dimensionamiento de mercado accesible (TAM: Mercado Total Accesible de accesibilidad, SAM: Mercado Disponible Útil en Latinoamérica, SOM: Cuota Objetivo inicial en México).
- **Cuándo invocar:**
  - Elaborar propuestas para convocatorias de financiamiento público o subsidios de innovación social.
  - Expandir las proyecciones de [[../Plan de negocio de EXPRESAT]].

### 2. `startup-business-analyst-financial-projections` & `cost-optimization`
- **Ubicación:**
  - `~/.gemini/config/skills/startup-business-analyst-financial-projections/SKILL.md`
  - `~/.gemini/config/skills/cost-optimization/SKILL.md`
- **Objetivo:** Modelado financiero a 3-5 años, cálculo de punto de equilibrio (*break-even*), costes operativos de servidores WebSocket frente a inferencia local Edge en C++.
- **Cuándo invocar:**
  - Definir precios en pesos mexicanos (MXN) y dólares (USD) según el coste por millón de inferencias (< $0.002 MXN por usuario-hora).

### 3. `billing-automation` & `stripe-integration`
- **Ubicación:**
  - `~/.gemini/config/skills/billing-automation/SKILL.md`
  - `~/.gemini/config/skills/stripe-integration/SKILL.md`
- **Objetivo:** Implementación de suscripciones recurrentes, gestión de pasarelas de pago con Stripe, manejo de webhooks para activación de planes y dunning.
- **Cuándo invocar:**
  - Integrar checkout de suscripciones en la app web de React con Supabase.

### 4. `legal-advisor` & `gdpr-data-handling`
- **Ubicación:**
  - `~/.gemini/config/skills/legal-advisor/SKILL.md`
  - `~/.gemini/config/skills/gdpr-data-handling/SKILL.md`
- **Objetivo:** Redacción de políticas de privacidad conformes a GDPR y LFPDPPP (México), términos de servicio y tratamiento de datos biométricos.
- **Cuándo invocar:**
  - Redactar avisos de privacidad relativos a la captura de video en vivo por cámara web.
  - Certificar que los frames de video no se almacenan en servidores y solo se procesan puntos vectoriales efímeros en RAM.

---

## 📋 Resumen del Modelo de Monetización

1. **Nivel Comunitario (Gratuito / Open Core):**
   - Acceso web y de escritorio libre para usuarios individuales y estudiantes.
   - Inferencia local o con límites de uso mensual.
2. **Nivel Pro (50 MXN / mes — aprox. $2.75 USD):**
   - Sesiones ilimitadas de traducción en tiempo real vía WebSocket.
   - Historial de vocabulario sincronizado con Supabase y síntesis de voz natural.
3. **Nivel Institucional / B2B / B2G (600 MXN / mes o licenciamiento anual):**
   - API de baja latencia para integración en ventanillas de atención ciudadana, hospitales o plataformas de videollamadas.
   - Soporte dedicado y despliegue local on-premise mediante `expresat-native`.

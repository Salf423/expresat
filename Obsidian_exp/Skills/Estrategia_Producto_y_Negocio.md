---
title: "Skills Especializadas: Estrategia de Negocio, Producto y Cumplimiento Legal"
description: "Habilidades para estructuración del modelo Open-Core, análisis de mercado TAM/SAM/SOM, pasarelas de pago Stripe, cumplimiento normativo GDPR y cálculo de costes unitarios."
version: "2.0.0"
category: "Skills / Negocio & Legal"
target_agents: ["business-analyst", "startup-analyst", "legal-advisor"]
related_docs:
  - "[[00_Matriz_General_Skills]]"
  - "[[../Plan de negocio de EXPRESAT]]"
---

# 💼 Skills Especializadas: Estrategia de Negocio, Producto y Cumplimiento Legal

> **Navegación:** [[../00_INDICE_MAESTRO|🏠 Índice Maestro]] > [[00_Matriz_General_Skills|🧭 Matriz de Skills]] > **Estrategia, Producto y Negocio**

**ExpresaT** fue concebido bajo una filosofía de **código abierto de impacto social (*Open Core*)**, permitiendo el acceso libre a usuarios finales y herramientas educativas, mientras monetiza mediante planes B2B y B2G (educación pública, salud, atención ciudadana) y cuotas de uso de API para empresas.

---

## 🛠️ Catálogo de Skills Instaladas en este Dominio

### 1. `startup-business-analyst-business-case` & `startup-business-analyst-market-opportunity`
- **Ubicación:**
  - `~/.gemini/config/skills/startup-business-analyst-business-case/SKILL.md`
  - `~/.gemini/config/skills/startup-business-analyst-market-opportunity/SKILL.md`
- **Objetivo:** Generación de casos de negocio completos, dimensionamiento de mercado accesible (TAM: Mercado Total Accesible de software de accesibilidad, SAM: Mercado Disponible Útil en Latinoamérica/España, SOM: Cuota Objetivo inicial).
- **Cuándo invocar:**
  - Elaborar propuestas para convocatorias de financiamiento público o subsidios de innovación social.
  - Expandir las proyecciones de [[../Plan de negocio de EXPRESAT]].

### 2. `startup-business-analyst-financial-projections` & `cost-optimization`
- **Ubicación:**
  - `~/.gemini/config/skills/startup-business-analyst-financial-projections/SKILL.md`
  - `~/.gemini/config/skills/cost-optimization/SKILL.md`
- **Objetivo:** Modelado financiero a 3-5 años, cálculo de punto de equilibrio (*break-even*), costes operativos de servidores WebSocket frente a inferencia local Edge en C++.
- **Cuándo invocar:**
  - Definir precios en pesos mexicanos (MXN) y dólares (USD) según el coste por millón de inferencias.

### 3. `billing-automation` & `stripe-integration`
- **Ubicación:**
  - `~/.gemini/config/skills/billing-automation/SKILL.md`
  - `~/.gemini/config/skills/stripe-integration/SKILL.md`
- **Objetivo:** Implementación de suscripciones recurrentes, gestión de pasarelas de pago con Stripe/PayPal, manejo de webhooks para activación de planes y dunning.
- **Cuándo invocar:**
  - Integrar checkout de suscripciones en la app web de React con Supabase.

### 4. `legal-advisor` & `gdpr-data-handling`
- **Ubicación:**
  - `~/.gemini/config/skills/legal-advisor/SKILL.md`
  - `~/.gemini/config/skills/gdpr-data-handling/SKILL.md`
- **Objetivo:** Redacción de políticas de privacidad conformes a GDPR/LFPDPPP (México), términos de servicio y tratamiento de datos biométricos.
- **Cuándo invocar:**
  - Redactar avisos de privacidad relativos a la captura de video en vivo por cámara web.
  - Certificar que los frames de video no se almacenan en servidores y solo se procesan puntos vectoriales efímeros en RAM.

### 5. `competitive-landscape`
- **Ubicación:** `~/.gemini/config/skills/competitive-landscape/SKILL.md`
- **Objetivo:** Análisis comparativo de soluciones de traducción de lengua de señas (modelos de visión basados en nubes cerradas vs. arquitectura Edge ultra-ligera de ExpresaT).

---

## 📋 Resumen del Modelo de Monetización

1. **Nivel Comunitario (Gratuito / Open Core):**
   - Acceso web y de escritorio libre para usuarios individuales y estudiantes.
   - Inferencia local o con límites de uso mensual.
2. **Nivel Pro (50 MXN / mes):**
   - Sesiones ilimitadas de traducción en tiempo real vía WebSocket.
   - Historial de vocabulario sincronizado con Supabase.
3. **Nivel Institucional / B2B / B2G (600 MXN / mes o licenciamiento anual):**
   - API de baja latencia para integración en ventanillas de atención ciudadana, hospitales o plataformas de videollamadas.
   - Soporte dedicado y despliegue local on-premise mediante `expresat-native`.

---
title: "Plan de Negocio y Estrategia de Producto — ExpresaT"
description: "Modelo de negocio Open-Core, análisis de mercado TAM/SAM/SOM (INEGI/OMS), segmentación de usuarios, pricing escalonado en MXN, economía unitaria, vocabulario LSM y cumplimiento regulatorio LFPDPPP/GDPR."
version: "2.3.0"
category: "Estrategia / Negocio"
status: "Producción"
target_agents: ["startup-analyst", "business-analyst", "legal-advisor"]
recommended_skills:
  - "[[Skills/Estrategia_Producto_y_Negocio|Estrategia_Producto_y_Negocio]] (`startup-business-analyst-business-case`, `startup-financial-modeling`)"
  - "[[Skills/Estrategia_Producto_y_Negocio|Estrategia_Producto_y_Negocio]] (`competitive-landscape`, `gdpr-data-handling`, `billing-automation`)"
related_docs:
  - "[[00_INDICE_MAESTRO]]"
  - "[[Caracteristicas]]"
  - "[[Deploys]]"
  - "[[Skills/Estrategia_Producto_y_Negocio]]"
---

# 📈 Plan de Negocio y Estrategia de Producto — ExpresaT

> **Navegación:** [[00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Plan de Negocio de EXPRESAT**

---

## 1. Resumen Ejecutivo y Misión

**ExpresaT** tiene como misión derribar las barreras de comunicación que aíslan a más de **70 millones de personas sordas** en el mundo (según la Federación Mundial de Sordos / OMS), y a más de **2.3 millones de personas** en México con dificultades auditivas o del habla (según el Censo de Población y Vivienda de INEGI).

A diferencia de las soluciones propietarias monolíticas que dependen de la nube y de costosas GPUs para procesar video continuo, **ExpresaT** democratiza la accesibilidad mediante un modelo **Open-Core** y una arquitectura ultra-eficiente en CPU (inferencia ONNX INT8 de tan solo ~2 ms con ~4 KB de grafo), permitiendo su despliegue tanto en terminales móviles económicas como en centros de atención pública sin infraestructura especializada.

---

## 2. Filosofía y Modelo "Open-Core"

```mermaid
flowchart TD
    Core["Comunidad Open-Core (Gratuito / AGPLv3/MIT)\n• Modelos base pre-entrenados\n• Generador de datasets v2 (Tasks Vision + Python)\n• Motor nativo C++ y cliente web básico"]
    
    Servicios["Servicios Comerciales de Valor Añadido (SaaS)\n• Nivel Pro: Sincronización nube Supabase y voz neural\n• Nivel B2B/B2G: Terminales para ventanillas de atención ciudadana\n• API de traducción WebSocket con SLA del 99.9%"]

    Core --> Servicios

    style Core fill:#1a3a6b,color:#fff
    style Servicios fill:#1d5b4a,color:#fff
```

- **Código Abierto (Community Edition):** Los modelos base, el capturador web de datasets, la aplicación nativa y el cliente web esencial son abiertos. La comunidad de personas sordas, intérpretes y lingüistas de LSM validan la semántica y aportan señas regionales.
- **Servicios de Valor Añadido (Commercial Tier):** Se monetiza mediante el mantenimiento de servidores WebSocket cloud de alta velocidad, APIs para plataformas de terceros (Zoom, Teams, plataformas educativas) y terminales corporativas para ventanillas de atención ciudadana y salud pública.

---

## 3. Análisis de Mercado (TAM / SAM / SOM)

```mermaid
pie title Distribución del Mercado Potencial en Accesibilidad Digital (LATAM)
    "SOM: Cuota Inicial Captable (Educación y Salud México)" : 15
    "SAM: Mercado Disponible Útil (México, Colombia y Centroamérica)" : 35
    "TAM: Mercado Total Accesible (Comunidad Sorda y B2G Hispanohablante)" : 50
```

1. **TAM (Total Addressable Market):** 
   - Más de **23 millones** de hispanohablantes con discapacidad auditiva o familiares directos, más un mercado de software de accesibilidad global valorado en más de **$32,000 millones de USD**.
2. **SAM (Serviceable Addressable Market):** 
   - Instituciones públicas, universidades, colegios de educación especial, hospitales y centros de atención telefónica/presencial en México y Latinoamérica (~$45 millones de USD anuales en licitaciones de inclusión social).
3. **SOM (Serviceable Obtainable Market):** 
   - Captación inicial de 100 escuelas primarias/secundarias y 15 entidades de salud pública en México durante los primeros 24 meses (~$450,000 USD anuales).

---

## 4. Segmentos de Clientes y Propuesta de Valor

| Segmento | Necesidad Principal | Propuesta de Valor de ExpresaT |
|---|---|---|
| **Usuarios Finales y Familias** | Comunicación fluida diaria en el hogar y aprendizaje continuo. | Aplicación accesible sin necesidad de computadoras con tarjetas gráficas dedicadas; privacidad total mediante procesamiento local en el dispositivo. |
| **Educación Pública y Universidades** | Integración de alumnos sordos en aulas convencionales. | Traducción bidireccional en tiempo real para proyectores de clase o tablets escolares a bajo coste de suscripción. |
| **Sector Salud y Hospitales (B2B/B2G)** | Triaje médico de emergencia con pacientes sordos sin intérprete presente. | Terminal nativa en mostradores de urgencias con disponibilidad 24/7 y sin tiempos de espera. |
| **Desarrolladores y Plataformas de Video** | Añadir subtítulos de lengua de señas a plataformas como Zoom, Teams o YouTube. | API WebSocket de ultra-baja latencia con SDKs en JavaScript, Python y C++. |

---

## 5. Estructura de Precios y Niveles de Servicio (MXN / USD)

```mermaid
graph LR
    A["Nivel Gratuito\n($0 MXN)"] --> B["Nivel Pro\n($50 MXN / mes)"]
    B --> C["Nivel Enterprise / B2G\n($600 MXN / mes / puesto)"]

    style A fill:#2d5a27,color:#fff
    style B fill:#1a3a6b,color:#fff
    style C fill:#6b1a2d,color:#fff
```

### Detalle de Niveles de Suscripción:

1. **Nivel Comunitario (Gratuito - $0 MXN):**
   - Descarga del binario nativo offline (`expresat-native`).
   - Inferencia 100% local en hardware del usuario.
   - Vocabulario estándar de señas de uso frecuente (`catalog/signs_catalog.json`).
   - Sin soporte SLA comercial (asistencia comunitaria en GitHub).

2. **Nivel Pro ($50 MXN / mes — aprox. $2.75 USD):**
   - Acceso completo a la plataforma web desde cualquier navegador sin instalación.
   - Inferencia procesada en servidores WebSocket en la nube de alta velocidad.
   - Módulo de síntesis de voz natural para verbalizar la traducción en altavoces del dispositivo.
   - Historial personal de aprendizaje y glosarios interactivos sincronizados con Supabase.

3. **Nivel Enterprise / B2B / B2G ($600 MXN / puesto / mes — aprox. $33 USD):**
   - Despliegue en terminales dedicadas para mostradores de atención ciudadana, bancos o clínicas.
   - SLA garantizado del 99.9% de disponibilidad en la API WebSocket.
   - Personalización del vocabulario con jerga técnica (médica, jurídica o administrativa local).
   - Métricas anonimizadas de uso, tiempos de atención y niveles de satisfacción.
   - Facturación empresarial formal y cumplimiento estricto con normativas de protección de datos.

4. **API para Desarrolladores:**
   - Primeras 10,000 inferencias mensuales gratuitas.
   - $1.50 MXN por cada 1,000 llamadas de inferencia posteriores.

---

## 6. Economía Unitaria y Eficiencia Operativa

Gracias a la optimización con ONNX Runtime CPU e INT8:
- **Consumo de Memoria por Instancia:** < 100 MB RAM (permite desplegar el contenedor en instancias micro de $5 a $10 USD/mes como Fly.io o Render).
- **Rendimiento de Concurrencia:** Una sola CPU de 2 núcleos puede atender hasta 80 clientes simultáneos transmitiendo secuencias por WebSocket.
- **Coste de Inferencia por Usuario Activo:** Menos de $0.002 MXN por hora de traducción activa continua, permitiendo un margen bruto superior al **88%** en las suscripciones Pro y Enterprise.

---

## 7. Privacidad y Cumplimiento Normativo (Legal)

- **Tratamiento de Datos Biométricos:** La cámara web analiza puntos geométricos en tiempo real en la memoria volátil del navegador o de la app. **Ningún fotograma de video o imagen facial es jamás grabado, almacenado ni transmitido a servidores remotos**.
- **Regulaciones:**
  - Cumplimiento de la **Ley General para la Inclusión de las Personas con Discapacidad (México)**.
  - Conformidad con principios de privacidad por diseño (**GDPR** en la Unión Europea y **LFPDPPP** en México).

---

## 🤖 Asignación de Agentes y Skills Recomendadas

- **Especialistas en Negocio:** Utiliza las skills de [[Skills/Estrategia_Producto_y_Negocio]]:
  - `startup-business-analyst-business-case` para redactar pitch decks e informes para inversores.
  - `startup-business-analyst-financial-projections` para actualizar hojas de balance y cash-flow.
  - `competitive-landscape` para vigilar competidores de visión artificial.
- **Especialistas Legales:** Activa `legal-advisor` y `gdpr-data-handling` para auditar la política de privacidad de la cámara web.
- **Especialistas en Cobro:** Activa `billing-automation` y `stripe-integration` para codificar la pasarela de pagos.

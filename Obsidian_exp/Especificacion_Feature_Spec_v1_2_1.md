---
title: "Especificación Canónica del Vector 178D (Histórico v1.2.1 → Canónico v1.3.0)"
description: "Documento de referencia histórica del FEATURE_SPEC v1.2.1 y su transición hacia FEATURE_SPEC v1.3.0 (aspecto 4:3, rotación corregida, ExtractWindow por bloques, config_hash con fixtures SHA-256)."
version: "1.2.1 (Superada por 1.3.0)"
category: "Especificación / IA & Visión"
status: "Referencia Histórica / Reemplazada por v1.3.0"
target_agents: ["ml-engineer", "cpp-pro", "frontend-developer", "data-engineering-data-pipeline"]
recommended_skills:
  - "[[Skills/MachineLearning_y_Vision|MachineLearning_y_Vision]] (`ml-engineer`, `data-engineering-data-pipeline`)"
  - "[[Skills/Backend_APIs_y_Sistemas|Backend_APIs_y_Sistemas]] (`cpp-pro`)"
related_docs:
  - "[[00_INDICE_MAESTRO]]"
  - "[[Especificacion_Feature_Spec_v1_3_0]]"
  - "[[Caracteristicas]]"
  - "[[Flujo de datos]]"
  - "[[Explicacion del codigo/Backend/Main C++]]"
  - "[[Explicacion del codigo/Dataset_Generator/02_Extraccion_y_Normalizacion]]"
---

# 📐 Especificación Canónica del Vector 178D (Histórico v1.2.1 → v1.3.0) — ExpresaT

> [!IMPORTANT] Actualización a FEATURE_SPEC v1.3.0
> Este documento describe la formulación original v1.2.1. Para la especificación vigente y obligatoria que rige los modelos reentrenados y el pipeline de producción, consulta:
> 👉 **[[Especificacion_Feature_Spec_v1_3_0|Especificación Canónica FEATURE_SPEC v1.3.0]]**

---

## 1. Resumen de la Evolución (v1.2.1 → v1.3.0)

| Característica / Criterio | FEATURE_SPEC v1.2.1 | FEATURE_SPEC v1.3.0 (Vigente) | Justificación de Ingeniería |
|---|---|---|---|
| **Relación de Aspecto de Cámara** | No impuesta formalmente | Estricta **640×480 (4:3)** con comprobación en vivo $|(W/H) - 4/3| \le 0.05$ | Evita distorsiones anamórficas de coordenadas normalizadas en web. |
| **Centro de Rotación para Augmentation** | Origen relativo genérico | **Centroide 3D de hombros ($C$)** con compensación $A = 4/3$ | Previene derivas excéntricas que expulsan las manos del campo visual. |
| **Evaluación de Compuertas de Calidad** | Mezcla entre crudo y aumentado | **Exclusiva en frames originales crudos** | El augmentation no puede ser usado para enmascarar ni descartar tomas crudas. |
| **Algoritmo `ExtractWindow`** | Secuencia lineal con asignación continua | **Secuencia por bloques anatómicos e inmutable** (pre-validación, asignación de manos, remuestreo, mediana de ventana, EMA con reset y ensamble) | Elimina cruces fantasma entre manos durante el remuestreo temporal. |
| **Conmutatividad de Espejo** | Mapeo de índices básico | Teorema probado $\text{Extract}(\text{Mirror}(\text{raw})) == \text{Mirror}(\text{Extract}(\text{raw}))$ con $L_\infty \le 10^{-6}$ | Garantiza paridad estricta entre señas diestras y zurdas. |
| **Estado de Motor C++ (`expresat-native`)** | Alineación tentativa en commit `a149fc5` | **Marcado como NO CONFORME**. Emite activamente `ERR_CPP_NOT_CONFORMANT` y `ERR_SHOULDERS_TOO_SMALL` | Política de seguridad: evita silent zero-filling o inconsistencias con `ExtractWindow`. |
| **Verificación de `config_hash`** | Hash de metadatos estáticos | Hash SHA-256 de parámetros + **digest SHA-256 de `tests/fixtures/feature_spec_cases.json`** | Blindaje contra divergencias numéricas entre Python y JavaScript. |

---

## 2. Archivo Legacy `letra_a_derecha_2.json` en Cuarentena

Tanto v1.2.1 como v1.3.0 mantienen el aislamiento obligatorio de `dataset/quarantine/letra_a_derecha_2.json`. Este archivo fue generado por `MediapipeExtractor` en C++ con modo STUB senoidal y un bug de escala que omitió la división por la distancia inter-humeral ($D \approx 0.0459$ en vez de $D = 1.0$), provocando desbordamiento de visibilidad ($1.0201$). Queda terminantemente prohibido su uso en entrenamiento.

---

## 3. Navegación

Para la implementación completa, códigos de error, matrices de coste y modelos Tasks Vision CPU, accede directamente a:
👉 **[[Especificacion_Feature_Spec_v1_3_0]]**

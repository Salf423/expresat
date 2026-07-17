expresat/
├── backend/                    # Servidor FastAPI + WebSocket
│   ├── main.py                # Punto entrada, gestión de conexiones WebSocket
│   ├── websockets_handler.py  # Manejador legacy (poco usado en v2)
│   ├── requirements.txt       # Dependencies: fastapi, uvicorn, onnxruntime, numpy
│   └── requirements-train.txt # Deps adicionales: torch, torchvision (para entrenamiento)
│
├── models/                    # Motor de IA + entrenamiento
│   ├── inference_engine.py    # Clase principal: carga ONNX, preprocesamiento, inferencia
│   ├── train_and_export.py    # Pipeline: PyTorch → ONNX → cuantización INT8
│   ├── inference.py           # Interfaz alternativa (deprecated)
│   └── exported_model/        # Directorio con modelo entrenado
│       ├── expresat_gru_int8.onnx      # Modelo cuantizado (preferido)
│       ├── expresat_gru_float32.onnx   # Modelo sin cuantizar
│       └── model_metadata.json         # Metadatos (labels, dimensiones, etc.)
│
├── frontend/                  # React + Vite + MediaPipe.js
│   ├── src/
│   │   ├── App.jsx            # Raíz de la app, rutas principales
│   │   ├── App.css            # Estilos glassmorphism
│   │   ├── main.jsx           # Punto entrada React
│   │   ├── index.css          # Estilos globales
│   │   │
│   │   ├── components/        # Componentes reutilizables
│   │   │   ├── Navbar.jsx     # Barra superior, nav links
│   │   │   ├── Footer.jsx     # Pie de página
│   │   │   ├── ThemeToggle.jsx# Switch tema oscuro/claro
│   │   │   └── EnvironmentSelector.jsx # Selector dev/prod
│   │   │
│   │   ├── pages/             # Páginas principales
│   │   │   ├── Home.jsx       # Landing page
│   │   │   ├── Translator.jsx # PÁGINA PRINCIPAL: cámara + traducción en tiempo real
│   │   │   ├── Auth.jsx       # Login/signup con Supabase
│   │   │   ├── Learn.jsx      # Tutoriales
│   │   │   └── About.jsx      # Información del proyecto
│   │   │
│   │   ├── services/          # Servicios / APIs
│   │   │   ├── apiService.js  # Conexión WebSocket al backend
│   │   │   ├── authService.js # Supabase auth, JWT tokens
│   │   │   └── mediapipeEngine.js # Inicialización de MediaPipe Holistic
│   │   │
│   │   ├── context/           # React Context API
│   │   ├── styles/            # CSS modular
│   │   └── assets/            # Imágenes, íconos
│   │
│   ├── index.html             # HTML de entrada
│   ├── package.json           # Dependencies: react, vite, lucide-react, supabase-js
│   ├── vite.config.js         # Config builder Vite
│   └── .oxlintrc.json         # Configuración linter
│
├── frontend-legacy/           # Versión anterior (HTML vanilla + JS puro)
│
├── docs/                      # Documentación
│   ├── BACKEND_TECHNICAL_SPEC.md # Especificación completa de arquitectura IA
│   └── deploy.md              # Instrucciones deployment
│
├── supabase/                  # Config Supabase (auth, DB)
│
├── netlify.toml               # Config deployment Netlify
│
├── exported_model/            # Symlink a models/exported_model/ (para acceso raíz)
│
└── README.md                  # Documentación principal

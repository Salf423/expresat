expresat/
├── backend/                    # FastAPI + WebSocket server
│   ├── main.py                # Entry point, WebSocket connection management
│   ├── websockets_handler.py  # Legacy handler (rarely used in v2)
│   ├── requirements.txt       # Dependencies: fastapi, uvicorn, onnxruntime, numpy
│   └── requirements-train.txt # Additional deps: torch, torchvision (for training)
│
├── models/                    # AI Engine + training
│   ├── inference_engine.py    # Main class: ONNX loading, preprocessing, inference
│   ├── train_and_export.py    # Pipeline: PyTorch → ONNX → INT8 quantization
│   ├── inference.py           # Alternative interface (deprecated)
│   └── exported_model/        # Directory containing trained model
│       ├── expresat_gru_int8.onnx      # Quantized model (preferred)
│       ├── expresat_gru_float32.onnx   # Unquantized model
│       └── model_metadata.json         # Metadata (labels, dimensions, etc.)
│
├── frontend/                  # React + Vite + MediaPipe.js
│   ├── src/
│   │   ├── App.jsx            # App root, main routes
│   │   ├── App.css            # Glassmorphism styles
│   │   ├── main.jsx           # React entry point
│   │   ├── index.css          # Global styles
│   │   │
│   │   ├── components/        # Reusable components
│   │   │   ├── Navbar.jsx     # Top bar, nav links
│   │   │   ├── Footer.jsx     # Page footer
│   │   │   ├── ThemeToggle.jsx# Dark/light theme toggle
│   │   │   └── EnvironmentSelector.jsx # Dev/prod selector
│   │   │
│   │   ├── pages/             # Main pages
│   │   │   ├── Home.jsx       # Landing page
│   │   │   ├── Translator.jsx # MAIN PAGE: camera + real-time translation
│   │   │   ├── Auth.jsx       # Login/signup with Supabase
│   │   │   ├── Learn.jsx      # Tutorials
│   │   │   └── About.jsx      # Project information
│   │   │
│   │   ├── services/          # Services / APIs
│   │   │   ├── apiService.js  # WebSocket connection to backend
│   │   │   ├── authService.js # Supabase auth, JWT tokens
│   │   │   └── mediapipeEngine.js # MediaPipe Holistic initialization
│   │   │
│   │   ├── context/           # React Context API
│   │   ├── styles/            # Modular CSS
│   │   └── assets/            # Images, icons
│   │
│   ├── index.html             # Entry HTML
│   ├── package.json           # Dependencies: react, vite, lucide-react, supabase-js
│   ├── vite.config.js         # Vite builder config
│   └── .oxlintrc.json         # Linter configuration
│
├── frontend-legacy/           # Legacy version (Vanilla HTML + Pure JS)
│
├── docs/                      # Documentation
│   ├── BACKEND_TECHNICAL_SPEC.md # Full AI architecture specification
│   └── deploy.md              # Deployment instructions
│
├── supabase/                  # Supabase config (auth, DB)
│
├── netlify.toml               # Netlify deployment config
│
├── exported_model/            # Symlink to models/exported_model/ (for root access)
│
└── README.md                  # Main documentation

## PROPÓSITO GENERAL

El frontend es una **aplicación React de tiempo real** que:

1. Captura video desde la cámara del usuario
2. Extrae landmarks (puntos clave) en tiempo real usando **MediaPipe Holistic**
3. Envía esos landmarks al backend vía **WebSocket**
4. Recibe traducciones y las muestra en pantalla

**Arquitectura**: React 19 + Vite + React Router + Context API (sin Redux/Zustand)

---

## ESTRUCTURA DE ARCHIVOS (COMPLETA)


expresat/frontend/
├── src/
│   ├── App.jsx                    # Raíz: define rutas principales
│   ├── main.jsx                   # Punto entrada: renderiza App en #root
│   │
│   ├── pages/                     # 5 páginas principales (React Router)
│   │   ├── Home.jsx              # Landing page (bienvenida)
│   │   ├── Translator.jsx        # ⭐ PÁGINA PRINCIPAL (captura + traducción)
│   │   ├── Auth.jsx              # Login/Register con Supabase
│   │   ├── Learn.jsx             # Tutoriales de señas
│   │   └── About.jsx             # Info del proyecto
│   │
│   ├── components/               # Componentes reutilizables
│   │   ├── Navbar.jsx            # Barra de navegación (header)
│   │   ├── Footer.jsx            # Pie de página
│   │   ├── ThemeToggle.jsx       # Botón tema oscuro/claro
│   │   └── EnvironmentSelector.jsx # Selector dev/prod API
│   │
│   ├── services/                 # Servicios/capas de abstracción
│   │   ├── apiService.js         # ⭐ WebSocket al backend
│   │   ├── authService.js        # Supabase auth (login/signup)
│   │   └── mediapipeEngine.js    # ⭐ Detección de landmarks MediaPipe
│   │
│   ├── context/                  # React Context API
│   │   └── ThemeContext.jsx      # Contexto para tema oscuro/claro
│   │
│   ├── styles/                   # (vacío en repo, estilos en CSS inline)
│   ├── assets/                   # Imágenes, iconos
│   ├── index.css                 # Estilos globales (CSS Variables)
│   └── App.css                   # Estilos específicos App
│
├── public/                        # Archivos estáticos
├── index.html                     # HTML principal (carga React)
├── package.json                   # Dependencies
├── vite.config.js                # Config Vite (sin cambios relevantes)
└── .oxlintrc.json                # Configuración linter Oxlint


## PUNTO CRÍTICO: Página Translator.jsx

### **FLUJO COMPLETO DE TRADUCCIÓN**



┌─────────────────────────────────────────────────────────────────┐
│ 1. useEffect se ejecuta AL MONTAR el componente                 │
├─────────────────────────────────────────────────────────────────┤
│   • Obtiene URL WebSocket del localStorage (dev vs prod)         │
│   • Crea instancia de ApiService                                 │
│   • Conecta con token 'mock_token'                               │
│   • Registra callbacks para status y mensajes                    │
│   • Crea instancia de MediaPipeEngine                            │
│   • Inicia captura de cámara                                     │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 2. MediaPipeEngine.start() inicia loop de captura                │
├─────────────────────────────────────────────────────────────────┤
│   • Camera captura frames @ 15 FPS (cada 66ms)                   │
│   • Holistic procesa cada frame y extrae landmarks               │
│   • onResults() dibuja en canvas y extrae coordenadas            │
│   • Llama onBatchReady() → apiService.sendLandmarks()            │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 3. ApiService envía landmarks vía WebSocket                      │
├─────────────────────────────────────────────────────────────────┤
│   • Payload: { type: 'inference', payload: landmarks }           │
│   • WebSocket abierto (readyState === OPEN)                      │
│   • Envía cada frame individual (stream mode)                    │
│   • Backend acumula en buffer hasta 15 frames                    │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 4. Backend procesa y devuelve traducción                         │
├─────────────────────────────────────────────────────────────────┤
│   • Mensaje: { type: 'translation', payload: {...} }             │
│   • ApiService.onmessage() recibe y parsea JSON                  │
│   • Extrae data.payload (contiene label, confidence, etc)        │
│   • Llama onMessageCallback() → setTranslation()                 │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 5. UI Actualiza en tiempo real                                   │
├─────────────────────────────────────────────────────────────────┤
│   • State 'translation' cambia → re-render                        │
│   • Muestra palabra traducida en panel derecho                    │
│   • Canvas dibuja landmarks y conectores en tiempo real           │
└─────────────────────────────────────────────────────────────────┘


### **Código Translator.jsx - Desglose**

JavaScript


const Translator = () => {
  // ========== REFS para acceso directo a elementos del DOM ==========
  const videoRef = useRef(null);          // Video element (oculto)
  const canvasRef = useRef(null);         // Canvas donde se dibuja
  const engineRef = useRef(null);         // Instancia MediaPipeEngine
  const apiRef = useRef(null);            // Instancia ApiService

  // ========== STATES para actualizar la UI ==========
  const [translation, setTranslation] = useState('');   // Palabra actual
  const [status, setStatus] = useState('Desconectado'); // WebSocket status
  const [statusClass, setStatusClass] = useState('status-offline');
  const [fps, setFps] = useState(0);      // Frames por segundo

  // ========== INICIALIZACIÓN (se ejecuta UNA SOLA VEZ) ==========
  useEffect(() => {
    // 1. Determinar URL del backend (localStorage o hardcode)
    const env = localStorage.getItem('apiEnv') || 'Local';
    const wsUrl = env === 'Local' 
      ? 'ws://127.0.0.1:8000/ws' 
      : 'wss://api.expresat.cloud/ws';

    // 2. Crear y conectar WebSocket
    const apiService = new ApiService(wsUrl);
    apiRef.current = apiService;
    apiService.connect('mock_token');

    // 3. Registrar callback cuando estado WebSocket cambia
    apiService.onStatusChange((text, className) => {
      setStatus(text);
      setStatusClass(className);
    });

    // 4. Registrar callback cuando llega traducción del servidor
    apiService.onMessage((text) => {
      setTranslation(text);  // Aquí recibimos el label traducido
    });

    // 5. Inicializar MediaPipe si no existe aún
    if (videoRef.current && canvasRef.current && !engineRef.current) {
      const engine = new MediaPipeEngine(
        videoRef.current, 
        canvasRef.current, 
        (landmarks) => {
          // Callback: cuando MediaPipe detecta landmarks, enviar al servidor
          apiService.sendLandmarks(landmarks);
        }
      );

      // 6. Reemplazar renderLoop para contar FPS correctamente
      //    (decisión: renderLoop original solo dibuja, no actualiza React)
      const originalRenderLoop = engine.renderLoop.bind(engine);
      engine.renderLoop = () => {
        engine.frameCount++;
        const now = performance.now();
        if (now - engine.lastFpsTime >= 1000) {
          setFps(engine.frameCount);  // Actualizar state cada 1 segundo
          engine.frameCount = 0;
          engine.lastFpsTime = now;
        }
        window.requestAnimationFrame(() => engine.renderLoop());
      };

      engine.start();  // Inicia captura de cámara
      engineRef.current = engine;
    }

    // 7. CLEANUP: cerrar WebSocket y detener cámara al desmontar
    return () => {
      if (apiRef.current?.ws) apiRef.current.ws.close();
      if (engineRef.current?.camera) engineRef.current.camera.stop();
    };
  }, []);  // [] = solo ejecutar una vez al montar

  // ========== RENDERIZADO UI ==========
  return (
    <div className="container animate-fade-in" style={{...}}>
      {/* Header con título y status */}
      <div style={{...}}>
        <h1>Traductor LSM</h1>
        <div className="glass-panel">
          {/* FPS Meter */}
          <span>FPS: <strong>{fps}</strong></span>
          {/* Status indicador */}
          <div style={{
            width: '10px', height: '10px', borderRadius: '50%',
            background: statusClass.includes('online') ? 'green' : 'red'
          }}></div>
          <span>{status}</span>
        </div>
      </div>

      {/* Grid 2 columnas: Video + Traducción */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))' }}>
        
        {/* VIDEO AREA */}
        <div className="glass-panel">
          <h3>Cámara</h3>
          <div>
            <video ref={videoRef} style={{display: 'none'}}></video>
            <canvas ref={canvasRef} width={640} height={480}></canvas>
          </div>
        </div>

        {/* TRANSLATION OUTPUT */}
        <div className="glass-panel">
          <h3>Traducción</h3>
          <div>
            {translation ? (
              <p style={{fontSize: '2rem'}}>{translation}</p>
            ) : (
              <p style={{color: 'grey'}}>Esperando señas...</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

---

## SERVICIO CRÍTICO #1: ApiService.js (WebSocket)

### **Responsabilidades**

- Conectar al servidor WebSocket
- Enviar landmarks al backend
- Recibir traducciones
- Manejar reconexiones automáticas
- Medir latencia con ping/pong

### **Estados de Conexión**


export class ApiService {
  constructor(url) {
    this.url = url;
    this.ws = null;                          // WebSocket instance
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.baseDelay = 1000;                  // 1 segundo entre intentos
    this.onMessageCallback = null;          // Callback traducción
    this.onStatusChangeCallback = null;     // Callback status
    this.pingInterval = null;               // Intervalo para enviar pings
    this.lastPingTime = 0;                  // Última vez que se envió ping
  }

  // ========== CONECTAR AL SERVIDOR ==========
  connect(token) {
    // URL con token como query param
    const wsUrl = `${this.url}?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(wsUrl);

    this.updateStatus('Conectando...', 'status-offline');

    // EVENT: Conexión exitosa
    this.ws.onopen = () => {
      console.log('WebSocket Conectado');
      this.reconnectAttempts = 0;
      this.updateStatus('Conectado', 'status-online');
      
      // Enviar ping cada 2 segundos para medir latencia
      this.pingInterval = setInterval(() => {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.lastPingTime = performance.now();
          this.ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 2000);
    };

    // EVENT: Mensaje recibido del servidor
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'pong') {
        // Calcular latencia: diferencia desde que se envió ping
        const latency = Math.round(performance.now() - this.lastPingTime);
        const latencyEl = document.getElementById('latency-counter');
        if(latencyEl) latencyEl.innerText = `Latencia: ${latency} ms`;
      } 
      else if (data.type === 'translation' && this.onMessageCallback) {
        // ⭐ CRÍTICO: cuando llega traducción del servidor
        // data.payload = { label: "hola", confidence: 0.95, ... }
        this.onMessageCallback(data.payload);  // Llama callback en Translator.jsx
      }
    };

    // EVENT: Desconexión
    this.ws.onclose = (event) => {
      console.warn('WebSocket Desconectado');
      this.updateStatus('Desconectado', 'status-offline');
      clearInterval(this.pingInterval);
      this.handleReconnect(token);  // Intentar reconectar
    };

    // EVENT: Error
    this.ws.onerror = (error) => {
      console.error('WebSocket Error:', error);
      this.updateStatus('Error', 'status-offline');
    };
  }

  // ========== RECONEXIÓN CON BACKOFF EXPONENCIAL ==========
  handleReconnect(token) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      // Delay exponencial: 1s, 2s, 4s, 8s, 16s
      const delay = this.baseDelay * Math.pow(2, this.reconnectAttempts);
      console.log(`Reconectando en ${delay}ms... (Intento ${this.reconnectAttempts + 1})`);
      
      setTimeout(() => {
        this.reconnectAttempts++;
        this.connect(token);
      }, delay);
    } else {
      this.updateStatus('Fallo conexión', 'status-offline');
    }
  }

  // ========== ACTUALIZAR STATUS EN LA UI ==========
  updateStatus(text, className) {
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback(text, className);
    }
  }

  // ========== ENVIAR LANDMARKS AL SERVIDOR ==========
  sendLandmarks(landmarksData) {
    // Solo enviar si WebSocket está abierto
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'inference',
        payload: landmarksData  // { pose: [...], leftHand: [...], rightHand: [...] }
      }));
    }
  }

  // ========== REGISTRAR CALLBACKS ==========
  onMessage(callback) {
    this.onMessageCallback = callback;
  }

  onStatusChange(callback) {
    this.onStatusChangeCallback = callback;
  }
}

### **Flujo de Mensajes WebSocket**


CLIENTE → SERVIDOR (Translator.jsx → ApiService → Backend)
{
  "type": "inference",
  "payload": {
    "pose": [
      {"x": 0.5, "y": 0.3, "z": -0.1},  // 33 landmarks en total
      ...
    ],
    "leftHand": [
      {"x": 0.4, "y": 0.2, "z": 0.0},   // 21 landmarks
      ...
    ],
    "rightHand": [
      {"x": 0.6, "y": 0.2, "z": 0.0},   // 21 landmarks
      ...
    ]
  }
}

SERVIDOR → CLIENTE (Backend → ApiService → Translator.jsx)
{
  "type": "translation",
  "payload": "hola"                     // O puede ser:
  // {
  //   "label": "hola",
  //   "confidence": 0.95,
  //   "latency_ms": 2.02
  // }
}

## SERVICIO CRÍTICO #2: MediaPipeEngine.js (Detección)

### **Responsabilidades**

- Inicializar MediaPipe Holistic
- Capturar video desde cámara
- Procesar frames en tiempo real
- Extraer landmarks (pose + manos)
- Dibujar en canvas (feedback visual)
- Llamar callback cuando hay landmarks

### **Código Desglosado**


export class MediaPipeEngine {
  constructor(videoElement, canvasElement, onBatchReady) {
    this.videoElement = videoElement;
    this.canvasElement = canvasElement;
    this.canvasCtx = canvasElement.getContext('2d');
    this.onBatchReady = onBatchReady;  // Callback a ApiService.sendLandmarks()

    // ========== CONFIGURACIÓN FPS ==========
    this.targetFPS = 15;               // 15 frames por segundo
    this.frameInterval = 1000 / 15;    // 66.67 ms entre frames
    this.lastFrameTime = 0;
    this.frameCount = 0;               // Para contar FPS
    this.lastFpsTime = performance.now();

    // ========== INICIALIZAR MEDIAPIPE HOLISTIC ==========
    // Holistic detecta: pose (33 puntos) + manos izq/der (21 c/u) + cara (opcional)
    this.holistic = new window.Holistic({
      locateFile: (file) => 
        `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`
    });

    // Opciones de detección
    this.holistic.setOptions({
      modelComplexity: 1,              // 0=lite, 1=full (más preciso)
      smoothLandmarks: true,           // Suavizar detecciones
      enableSegmentation: false,       // No necesitamos segmentación
      smoothSegmentation: false,
      refineFaceLandmarks: false,      // No necesitamos face details
      minDetectionConfidence: 0.5,    // Umbral mínimo para detectar
      minTrackingConfidence: 0.5      // Umbral mínimo para trackear
    });

    // Registrar callback cuando se detectan landmarks
    this.holistic.onResults((results) => this.onResults(results));

    // ========== INICIALIZAR CÁMARA ==========
    this.camera = new window.Camera(this.videoElement, {
      onFrame: async () => {
        // Throttle: procesar solo cada 66ms (15 FPS)
        const now = performance.now();
        if (now - this.lastFrameTime >= this.frameInterval) {
          this.lastFrameTime = now;
          // Enviar frame actual a Holistic para procesamiento
          await this.holistic.send({ image: this.videoElement });
        }
      },
      width: 640,   // Resolución video capturado
      height: 480
    });
  }

  // ========== INICIAR CAPTURA ==========
  start() {
    this.camera.start();  // Abre cámara y comienza loop onFrame
    this.renderLoop();    // Inicia loop de renderizado
  }

  // ========== LOOP DE RENDERIZADO (para mostrar FPS en React) ==========
  renderLoop() {
    this.frameCount++;
    const now = performance.now();
    
    // Cada 1 segundo, actualizar contador FPS
    if (now - this.lastFpsTime >= 1000) {
      if (this.fpsElement) {
        this.fpsElement.innerText = `FPS: ${this.frameCount}`;
      }
      this.frameCount = 0;
      this.lastFpsTime = now;
    }
    
    // Continuar loop
    window.requestAnimationFrame(() => this.renderLoop());
  }

  // ========== PROCESAR RESULTADOS DE MEDIAPIPE ==========
  onResults(results) {
    // 'results' contiene: { image, poseLandmarks, leftHandLandmarks, rightHandLandmarks, ... }

    this.canvasCtx.save();
    
    // Limpiar canvas y dibujar video frame
    this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
    this.canvasCtx.drawImage(
      results.image, 
      0, 0, 
      this.canvasElement.width, 
      this.canvasElement.height
    );

    // ========== DIBUJAR POSE ==========
    if (results.poseLandmarks) {
      // Conectores: líneas entre joints (hombro-codo, codo-muñeca, etc)
      window.drawConnectors(
        this.canvasCtx, 
        results.poseLandmarks, 
        window.POSE_CONNECTIONS,  // Lista de pares de índices a conectar
        { color: '#00f3ff', lineWidth: 4 }  // Cyan, grueso
      );
      // Puntos: círculos en cada landmark
      window.drawLandmarks(
        this.canvasCtx, 
        results.poseLandmarks, 
        { color: '#ffffff', lineWidth: 2 }  // Blanco
      );
    }

    // ========== DIBUJAR MANO IZQUIERDA ==========
    if (results.leftHandLandmarks) {
      window.drawConnectors(
        this.canvasCtx,
        results.leftHandLandmarks,
        window.HAND_CONNECTIONS,  // 20 conexiones (dedos, palma)
        { color: '#9d4edd', lineWidth: 5 }  // Purple
      );
      window.drawLandmarks(
        this.canvasCtx,
        results.leftHandLandmarks,
        { color: '#ffffff', lineWidth: 2 }
      );
    }

    // ========== DIBUJAR MANO DERECHA ==========
    if (results.rightHandLandmarks) {
      window.drawConnectors(
        this.canvasCtx,
        results.rightHandLandmarks,
        window.HAND_CONNECTIONS,
        { color: '#9d4edd', lineWidth: 5 }  // Purple
      );
      window.drawLandmarks(
        this.canvasCtx,
        results.rightHandLandmarks,
        { color: '#ffffff', lineWidth: 2 }
      );
    }

    this.canvasCtx.restore();

    // ========== EXTRAER Y ENVIAR LANDMARKS ==========
    const payload = this.extractLandmarks(results);
    if (this.onBatchReady) {
      this.onBatchReady(payload);  // Llama a ApiService.sendLandmarks()
    }
  }

  // ========== EXTRAER SOLO COORDENADAS (x, y, z) ==========
  extractLandmarks(results) {
    // Helper: extrae x, y, z de cada landmark
    const extract = (landmarks) => {
      if (!landmarks) return null;
      return landmarks.map(lm => ({ 
        x: lm.x, 
        y: lm.y, 
        z: lm.z 
        // Nota: se descarta 'visibility' para reducir payload JSON
      }));
    };

    // Retorna estructura normalizada
    return {
      pose: extract(results.poseLandmarks),           // 33 landmarks
      leftHand: extract(results.leftHandLandmarks),   // 21 landmarks
      rightHand: extract(results.rightHandLandmarks)  // 21 landmarks
    };
  }
}
### **Visualización en Canvas**


┌─────────────────────────────────────────┐
│         CANVAS (640x480)                │
├─────────────────────────────────────────┤
│                                         │
│  ● (cabeza, cyan)                      │
│  │ │ (conectores pose, cyan)           │
│  ○─○ (hombros)                         │
│  │ │ │ (brazos extendidos)             │
│ ✓   ✓ (manos, purple con dedos)        │
│                                         │
└─────────────────────────────────────────┘

Colores:
• Pose:     CYAN (#00f3ff)    - esqueleto principal
• Manos:    PURPLE (#9d4edd)  - dedos y palma
• Puntos:   WHITE (#ffffff)   - joints individuales


## 🔐 SERVICIO #3: AuthService.js (Supabase Auth)


export class AuthService {
  async login(email, password) {
    // Autentica usuario y obtiene JWT token
  }

  async register(email, password, fullName) {
    // Registra nuevo usuario
  }

  async resetPassword(email) {
    // Envía email para reset
  }

  async logout() {
    // Cierra sesión actual
  }

  async getSession() {
    // Obtiene sesión activa del usuario
  }

  onAuthStateChange(callback) {
    // Suscribirse a cambios de autenticación
  }
}

## CONTEXTO: ThemeContext.jsx

JavaScript

// Context Global para tema oscuro/claro
const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    // Recuperar del localStorage o usar preferencia del sistema
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches 
      ? 'dark' 
      : 'light';
  });

  useEffect(() => {
    // Aplicar tema al documento
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);

**Uso en componentes**:


const MyComponent = () => {
  const { theme, toggleTheme } = useTheme();
  return <button onClick={toggleTheme}>Cambiar tema</button>;
};

## 🎯 ROUTING (React Router V7)

### **App.jsx**


function App() {
  return (
    <ThemeProvider>
      <Router>
        <div className="bg-blob blob-1"></div>  {/* Decoración */}
        <div className="bg-blob blob-2"></div>  {/* Decoración */}
        
        <Navbar />  {/* Header fijo */}
        
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/translator" element={<Translator />} />
            <Route path="/learn" element={<Learn />} />
            <Route path="/about" element={<About />} />
            <Route path="/auth" element={<Auth />} />
          </Routes>
        </main>
        
        <Footer />  {/* Footer */}
      </Router>
    </ThemeProvider>
  );
}


## 🧵CICLO DE VIDA COMPLETO (Diagrama de Flujo)

Code


┌─────────────────────────────────────────────────────────────────┐
│ 1. APP CARGA (index.html → main.jsx → App.jsx)                 │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 2. ThemeProvider envuelve toda la app (contexto tema)           │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 3. Router carga ruta inicial (/ = Home)                         │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 4. Navbar renderizado (fijo en top)                              │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 5. Usuario navega a /translator (clic en botón)                 │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 6. Translator.jsx monta (useEffect con [])                      │
├─────────────────────────────────────────────────────────────────┤
│   • Conecta WebSocket                                            │
│   • Inicializa MediaPipeEngine                                   │
│   • Inicia captura de cámara                                     │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 7. LOOP EN TIEMPO REAL                                           │
├─────────────────────────────────────────────────────────────────┤
│   Cada 66ms (15 FPS):                                            │
│   • Camera captura frame                                         │
│   • Holistic procesa                                             │
│   • onResults() extrae landmarks                                 │
│   • sendLandmarks() → WebSocket → Backend                        │
│   • Backend procesa y devuelve traducción                        │
│   • onMessage() → setTranslation() → UI actualiza                │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 8. Usuario navega a otra página o recarga                       │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 9. CLEANUP (return de useEffect)                                │
├─────────────────────────────────────────────────────────────────┤
│   • Cierra WebSocket                                             │
│   • Detiene cámara                                               │
│   • Limpia refs                                                  │
└─────────────────────────────────────────────────────────────────┘

## SISTEMA DE ESTILOS

### **CSS Variables (index.css + App.css)**


:root {
  /* Tema claro (defecto) */
  --text: #6b6375;           /* Texto principal */
  --text-h: #08060d;         /* Headings */
  --bg: #fff;                /* Fondo */
  --border: #e5e4e7;        /* Bordes */
  --accent: #aa3bff;        /* Color primario (purple) */
  --accent-bg: rgba(170, 59, 255, 0.1);
  --accent-border: rgba(170, 59, 255, 0.5);
  
  --sans: system-ui, 'Segoe UI', Roboto, sans-serif;
  font-size: 18px;
  line-height: 145%;
}

@media (prefers-color-scheme: dark) {
  :root {
    /* Tema oscuro */
    --text: #9ca3af;
    --text-h: #f3f4f6;
    --bg: #16171d;
    --border: #2e303a;
    --accent: #c084fc;
  }
}
### **Clases Reutilizables**


.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

.glass-panel {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  padding: 1.5rem;
  /* Efecto glassmorphism */
}

.btn-primary {
  background: linear-gradient(135deg, var(--accent) 0%, #7c3aed 100%);
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
}

.gradient-text {
  background: linear-gradient(135deg, var(--accent) 0%, #7c3aed 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}


## ESTADO GLOBAL (Sin Redux/Zustand)

La app usa **React Context API** para estado mínimo:

- **ThemeContext**: tema oscuro/claro

**¿Por qué no Redux?**

- App es pequeña y componentes no están muy anidados
- Context API es suficiente para este caso
- Menos boilerplate, más simple de entender

---

## HOOKS USADOS

|Hook|Dónde|Propósito|
|---|---|---|
|`useState`|Todos los componentes|Gestionar estado local|
|`useEffect`|Translator.jsx|Iniciar/limpiar servicios|
|`useRef`|Translator.jsx|Acceso directo a DOM|
|`useContext`|ThemeToggle.jsx|Acceder a ThemeContext|
|`useLocation`|Navbar.jsx|Detectar ruta activa|

---

## BUILD & DEPLOY

### **Desarrollo Local**

bash


cd expresat/frontend
npm install
npm run dev
# Acceder a http://localhost:5173


### **Producción**

bash


npm run build  # Genera /dist
# Deploy /dist a Netlify (automático vía netlify.toml)

### **Linting**


npm run lint  # Oxlint (más rápido que ESLint)


## RESPONSIVE DESIGN

CSS

/* Mobile-first */
@media (max-width: 768px) {
  .desktop-only { display: none; }
  .mobile-only { display: inline-flex; }
  
  .container {
    padding: 1rem;
  }
  
  [style*="grid"] {
    grid-template-columns: 1fr; /* Stack verticalmente */
  }
}
## INTEGRACIONES EXTERNAS

|Servicio|Uso|Referencia|
|---|---|---|
|**Supabase**|Auth (login/signup)|authService.js|
|**MediaPipe**|Detección landmarks|mediapipeEngine.js (CDN)|
|**Lucide React**|Iconos UI|Components, Pages|
|**React Router**|Navegación|App.jsx|

---

##  DECISIONES CLAVE EN EL FRONTEND

1. **WebSocket en lugar de HTTP**: Necesario para streaming en tiempo real (latencia baja)
2. **MediaPipe CDN en lugar de npm**: Versión pre-compilada desde CDN para evitar bundling de WASM
3. **Stream mode + buffer**: El frontend envía frame a frame, el backend acumula en buffer
4. **Canvas en lugar de video visible**: Mayor control visual (dibuja landmarks)
5. **React sin TypeScript**: Proyecto de prototipo rápido
6. **Contexto simple en lugar de Redux**: App pequeña, no justifica complejidad

---

##  PUNTOS CRÍTICOS PARA EL AGENTE

1. **Translator.jsx es la página principal** - todo sucede aquí
2. **MediaPipeEngine maneja captura** - 15 FPS throttled
3. **ApiService maneja WebSocket** - stream mode (frame por frame)
4. **Backend acumula 15 frames antes de inferencia** - cliente no necesita saber
5. **Estado React mínimo**: translation, status, fps
6. **Refs (no state) para**: video, canvas, engine, api
7. **useEffect [] = una sola inicialización** - el cleanup detiene cámara/ws
8. **Estilos CSS Variables** - tema oscuro/claro dinámico
9. **No autenticación completamente funcional** - usa 'mock_token' por ahora
10. **Glassmorphism UI** - backdrop-filter blur, rgba colors
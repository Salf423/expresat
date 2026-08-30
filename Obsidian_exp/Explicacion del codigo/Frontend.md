## GENERAL PURPOSE

The frontend is a **real-time React application** that:

1. Captures video from the user's camera
2. Extracts keypoint landmarks in real time using **MediaPipe Holistic**
3. Sends those landmarks to the backend via **WebSocket**
4. Receives translations and displays them on screen

**Architecture**: React 19 + Vite + React Router + Context API (no Redux/Zustand)

---

## FILE STRUCTURE (COMPLETE)

```
expresat/frontend/
├── src/
│   ├── App.jsx                    # Root: defines main routes
│   ├── main.jsx                   # Entry point: renders App inside #root
│   │
│   ├── pages/                     # 5 main pages (React Router)
│   │   ├── Home.jsx              # Landing page (welcome)
│   │   ├── Translator.jsx        # ⭐ MAIN PAGE (capture + translation)
│   │   ├── Auth.jsx              # Login/Register with Supabase
│   │   ├── Learn.jsx             # Sign language tutorials
│   │   └── About.jsx             # Project info
│   │
│   ├── components/               # Reusable components
│   │   ├── Navbar.jsx            # Navigation bar (header)
│   │   ├── Footer.jsx            # Footer
│   │   ├── ThemeToggle.jsx       # Dark/light theme button
│   │   └── EnvironmentSelector.jsx # Dev/prod API selector
│   │
│   ├── services/                 # Service/abstraction layer
│   │   ├── apiService.js         # ⭐ Backend WebSocket
│   │   ├── authService.js        # Supabase auth (login/signup)
│   │   └── mediapipeEngine.js    # ⭐ MediaPipe landmark detection
│   │
│   ├── context/                  # React Context API
│   │   └── ThemeContext.jsx      # Dark/light theme context
│   │
│   ├── styles/                   # (empty in repo, styles in inline CSS)
│   ├── assets/                   # Images, icons
│   ├── index.css                 # Global styles (CSS Variables)
│   └── App.css                   # App-specific styles
│
├── public/                        # Static files
├── index.html                     # Main HTML (loads React)
├── package.json                   # Dependencies
├── vite.config.js                # Vite config
└── .oxlintrc.json                # Oxlint linter configuration
```

---

## CRITICAL POINT: Translator.jsx Page

### **COMPLETE TRANSLATION FLOW**

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. useEffect runs ON MOUNTING the component                     │
├─────────────────────────────────────────────────────────────────┤
│   • Retrieves WebSocket URL from localStorage (dev vs prod)     │
│   • Creates ApiService instance                                 │
│   • Connects with token 'mock_token'                            │
│   • Registers callbacks for status and messages                 │
│   • Creates MediaPipeEngine instance                            │
│   • Starts camera capture                                       │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 2. MediaPipeEngine.start() initiates capture loop               │
├─────────────────────────────────────────────────────────────────┤
│   • Camera captures frames @ 15 FPS (every 66ms)                │
│   • Holistic processes each frame and extracts landmarks        │
│   • onResults() draws on canvas and extracts coordinates        │
│   • Calls onBatchReady() → apiService.sendLandmarks()           │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 3. ApiService sends landmarks via WebSocket                     │
├─────────────────────────────────────────────────────────────────┤
│   • Payload: { type: 'inference', payload: landmarks }          │
│   • WebSocket open (readyState === OPEN)                        │
│   • Sends each individual frame (stream mode)                   │
│   • Backend accumulates in buffer up to 15 frames               │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 4. Backend processes and returns translation                    │
├─────────────────────────────────────────────────────────────────┤
│   • Message: { type: 'translation', payload: {...} }            │
│   • ApiService.onmessage() receives and parses JSON             │
│   • Extracts data.payload (contains label, confidence, etc.)    │
│   • Calls onMessageCallback() → setTranslation()                │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 5. UI Updates in Real Time                                      │
├─────────────────────────────────────────────────────────────────┤
│   • State 'translation' changes → re-render                     │
│   • Displays translated word in right panel                     │
│   • Canvas draws landmarks and connectors in real time          │
└─────────────────────────────────────────────────────────────────┘
```

### **Translator.jsx Code Breakdown**

```javascript
const Translator = () => {
  // ========== REFS for direct DOM access ==========
  const videoRef = useRef(null);          // Video element (hidden)
  const canvasRef = useRef(null);         // Canvas element for drawing
  const engineRef = useRef(null);         // MediaPipeEngine instance
  const apiRef = useRef(null);            // ApiService instance

  // ========== STATES to update UI ==========
  const [translation, setTranslation] = useState('');   // Current word
  const [status, setStatus] = useState('Disconnected'); // WebSocket status
  const [statusClass, setStatusClass] = useState('status-offline');
  const [fps, setFps] = useState(0);      // Frames per second

  // ========== INITIALIZATION (runs ONCE) ==========
  useEffect(() => {
    // 1. Determine backend URL (localStorage or fallback)
    const env = localStorage.getItem('apiEnv') || 'Local';
    const wsUrl = env === 'Local' 
      ? 'ws://127.0.0.1:8000/ws' 
      : 'wss://api.expresat.cloud/ws';

    // 2. Create and connect WebSocket
    const apiService = new ApiService(wsUrl);
    apiRef.current = apiService;
    apiService.connect('mock_token');

    // 3. Register callback when WebSocket state changes
    apiService.onStatusChange((text, className) => {
      setStatus(text);
      setStatusClass(className);
    });

    // 4. Register callback when server translation arrives
    apiService.onMessage((text) => {
      setTranslation(text);  // Received translated label
    });

    // 5. Initialize MediaPipe if not created yet
    if (videoRef.current && canvasRef.current && !engineRef.current) {
      const engine = new MediaPipeEngine(
        videoRef.current, 
        canvasRef.current, 
        (landmarks) => {
          // Callback: send landmarks to server when MediaPipe detects them
          apiService.sendLandmarks(landmarks);
        }
      );

      // 6. Override renderLoop to measure FPS accurately
      const originalRenderLoop = engine.renderLoop.bind(engine);
      engine.renderLoop = () => {
        engine.frameCount++;
        const now = performance.now();
        if (now - engine.lastFpsTime >= 1000) {
          setFps(engine.frameCount);  // Update state every 1 second
          engine.frameCount = 0;
          engine.lastFpsTime = now;
        }
        window.requestAnimationFrame(() => engine.renderLoop());
      };

      engine.start();  // Start camera capture
      engineRef.current = engine;
    }

    // 7. CLEANUP: close WebSocket and stop camera on unmount
    return () => {
      if (apiRef.current?.ws) apiRef.current.ws.close();
      if (engineRef.current?.camera) engineRef.current.camera.stop();
    };
  }, []);  // [] = run only once on mount

  // ========== UI RENDERING ==========
  return (
    <div className="container animate-fade-in" style={{...}}>
      {/* Header with title and status */}
      <div style={{...}}>
        <h1>LSM Translator</h1>
        <div className="glass-panel">
          {/* FPS Meter */}
          <span>FPS: <strong>{fps}</strong></span>
          {/* Status indicator */}
          <div style={{
            width: '10px', height: '10px', borderRadius: '50%',
            background: statusClass.includes('online') ? 'green' : 'red'
          }}></div>
          <span>{status}</span>
        </div>
      </div>

      {/* 2-column Grid: Video + Translation */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))' }}>
        
        {/* VIDEO AREA */}
        <div className="glass-panel">
          <h3>Camera</h3>
          <div>
            <video ref={videoRef} style={{display: 'none'}}></video>
            <canvas ref={canvasRef} width={640} height={480}></canvas>
          </div>
        </div>

        {/* TRANSLATION OUTPUT */}
        <div className="glass-panel">
          <h3>Translation</h3>
          <div>
            {translation ? (
              <p style={{fontSize: '2rem'}}>{translation}</p>
            ) : (
              <p style={{color: 'grey'}}>Waiting for signs...</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
```

---

## CRITICAL SERVICE #1: ApiService.js (WebSocket)

### **Responsibilities**

- Connect to WebSocket server
- Send landmarks to backend
- Receive translations
- Handle automatic reconnections
- Measure latency using ping/pong

### **Connection States**

```javascript
export class ApiService {
  constructor(url) {
    this.url = url;
    this.ws = null;                          // WebSocket instance
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.baseDelay = 1000;                  // 1 second delay between attempts
    this.onMessageCallback = null;          // Translation callback
    this.onStatusChangeCallback = null;     // Status callback
    this.pingInterval = null;               // Interval for sending pings
    this.lastPingTime = 0;                  // Last ping timestamp
  }

  // ========== CONNECT TO SERVER ==========
  connect(token) {
    // URL with token as query parameter
    const wsUrl = `${this.url}?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(wsUrl);

    this.updateStatus('Connecting...', 'status-offline');

    // EVENT: Successful connection
    this.ws.onopen = () => {
      console.log('WebSocket Connected');
      this.reconnectAttempts = 0;
      this.updateStatus('Connected', 'status-online');
      
      // Send ping every 2 seconds to measure latency
      this.pingInterval = setInterval(() => {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.lastPingTime = performance.now();
          this.ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 2000);
    };

    // EVENT: Message received from server
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'pong') {
        // Calculate latency: time elapsed since ping sent
        const latency = Math.round(performance.now() - this.lastPingTime);
        const latencyEl = document.getElementById('latency-counter');
        if(latencyEl) latencyEl.innerText = `Latency: ${latency} ms`;
      } 
      else if (data.type === 'translation' && this.onMessageCallback) {
        // ⭐ CRITICAL: when server returns translation
        // data.payload = { label: "hola", confidence: 0.95, ... }
        this.onMessageCallback(data.payload);  // Calls callback in Translator.jsx
      }
    };

    // EVENT: Disconnection
    this.ws.onclose = (event) => {
      console.warn('WebSocket Disconnected');
      this.updateStatus('Disconnected', 'status-offline');
      clearInterval(this.pingInterval);
      this.handleReconnect(token);  // Attempt reconnection
    };

    // EVENT: Error
    this.ws.onerror = (error) => {
      console.error('WebSocket Error:', error);
      this.updateStatus('Error', 'status-offline');
    };
  }

  // ========== EXPONENTIAL BACKOFF RECONNECTION ==========
  handleReconnect(token) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      // Exponential delay: 1s, 2s, 4s, 8s, 16s
      const delay = this.baseDelay * Math.pow(2, this.reconnectAttempts);
      console.log(`Reconnecting in ${delay}ms... (Attempt ${this.reconnectAttempts + 1})`);
      
      setTimeout(() => {
        this.reconnectAttempts++;
        this.connect(token);
      }, delay);
    } else {
      this.updateStatus('Connection failed', 'status-offline');
    }
  }

  // ========== UPDATE STATUS IN UI ==========
  updateStatus(text, className) {
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback(text, className);
    }
  }

  // ========== SEND LANDMARKS TO SERVER ==========
  sendLandmarks(landmarksData) {
    // Only send if WebSocket is open
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'inference',
        payload: landmarksData  // { pose: [...], leftHand: [...], rightHand: [...] }
      }));
    }
  }

  // ========== REGISTER CALLBACKS ==========
  onMessage(callback) {
    this.onMessageCallback = callback;
  }

  onStatusChange(callback) {
    this.onStatusChangeCallback = callback;
  }
}
```

### **WebSocket Message Flow**

```
CLIENT → SERVER (Translator.jsx → ApiService → Backend)
{
  "type": "inference",
  "payload": {
    "pose": [
      {"x": 0.5, "y": 0.3, "z": -0.1},  // 33 landmarks total
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

SERVER → CLIENT (Backend → ApiService → Translator.jsx)
{
  "type": "translation",
  "payload": "hola"                     // Or structured object:
  // {
  //   "label": "hola",
  //   "confidence": 0.95,
  //   "latency_ms": 2.02
  // }
}
```

---

## CRITICAL SERVICE #2: MediaPipeEngine.js (Detection)

### **Responsibilities**

- Initialize MediaPipe Holistic
- Capture camera video stream
- Process frames in real time
- Extract landmarks (pose + hands)
- Draw on canvas (visual feedback)
- Invoke callback when landmarks are extracted

### **Code Breakdown**

```javascript
export class MediaPipeEngine {
  constructor(videoElement, canvasElement, onBatchReady) {
    this.videoElement = videoElement;
    this.canvasElement = canvasElement;
    this.canvasCtx = canvasElement.getContext('2d');
    this.onBatchReady = onBatchReady;  // Callback to ApiService.sendLandmarks()

    // ========== FPS CONFIGURATION ==========
    this.targetFPS = 15;               // 15 frames per second
    this.frameInterval = 1000 / 15;    // 66.67 ms between frames
    this.lastFrameTime = 0;
    this.frameCount = 0;               // To measure FPS
    this.lastFpsTime = performance.now();

    // ========== INITIALIZE MEDIAPIPE HOLISTIC ==========
    // Holistic detects: pose (33 points) + left/right hands (21 each) + face (optional)
    this.holistic = new window.Holistic({
      locateFile: (file) => 
        `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`
    });

    // Detection options
    this.holistic.setOptions({
      modelComplexity: 1,              // 0=lite, 1=full (more precise)
      smoothLandmarks: true,           // Smooth landmark detections
      enableSegmentation: false,       // Segmentation not required
      smoothSegmentation: false,
      refineFaceLandmarks: false,      // Detailed face landmarks not required
      minDetectionConfidence: 0.5,    // Minimum confidence for detection
      minTrackingConfidence: 0.5      // Minimum confidence for tracking
    });

    // Register callback when landmarks are detected
    this.holistic.onResults((results) => this.onResults(results));

    // ========== INITIALIZE CAMERA ==========
    this.camera = new window.Camera(this.videoElement, {
      onFrame: async () => {
        // Throttle: process only every 66ms (15 FPS)
        const now = performance.now();
        if (now - this.lastFrameTime >= this.frameInterval) {
          this.lastFrameTime = now;
          // Send current frame to Holistic for processing
          await this.holistic.send({ image: this.videoElement });
        }
      },
      width: 640,   // Captured video resolution
      height: 480
    });
  }

  // ========== START CAPTURE ==========
  start() {
    this.camera.start();  // Opens camera and starts onFrame loop
    this.renderLoop();    // Starts render loop
  }

  // ========== RENDER LOOP (for displaying FPS in React) ==========
  renderLoop() {
    this.frameCount++;
    const now = performance.now();
    
    // Update FPS counter every 1 second
    if (now - this.lastFpsTime >= 1000) {
      if (this.fpsElement) {
        this.fpsElement.innerText = `FPS: ${this.frameCount}`;
      }
      this.frameCount = 0;
      this.lastFpsTime = now;
    }
    
    // Continue loop
    window.requestAnimationFrame(() => this.renderLoop());
  }

  // ========== PROCESS MEDIAPIPE RESULTS ==========
  onResults(results) {
    // 'results' contains: { image, poseLandmarks, leftHandLandmarks, rightHandLandmarks, ... }

    this.canvasCtx.save();
    
    // Clear canvas and draw video frame
    this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
    this.canvasCtx.drawImage(
      results.image, 
      0, 0, 
      this.canvasElement.width, 
      this.canvasElement.height
    );

    // ========== DRAW POSE ==========
    if (results.poseLandmarks) {
      // Connectors: lines between joints (shoulder-elbow, elbow-wrist, etc.)
      window.drawConnectors(
        this.canvasCtx, 
        results.poseLandmarks, 
        window.POSE_CONNECTIONS,  // List of index pairs to connect
        { color: '#00f3ff', lineWidth: 4 }  // Cyan, thick
      );
      // Points: circles at each landmark
      window.drawLandmarks(
        this.canvasCtx, 
        results.poseLandmarks, 
        { color: '#ffffff', lineWidth: 2 }  // White
      );
    }

    // ========== DRAW LEFT HAND ==========
    if (results.leftHandLandmarks) {
      window.drawConnectors(
        this.canvasCtx,
        results.leftHandLandmarks,
        window.HAND_CONNECTIONS,  // 20 connections (fingers, palm)
        { color: '#9d4edd', lineWidth: 5 }  // Purple
      );
      window.drawLandmarks(
        this.canvasCtx,
        results.leftHandLandmarks,
        { color: '#ffffff', lineWidth: 2 }
      );
    }

    // ========== DRAW RIGHT HAND ==========
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

    // ========== EXTRACT AND SEND LANDMARKS ==========
    const payload = this.extractLandmarks(results);
    if (this.onBatchReady) {
      this.onBatchReady(payload);  // Calls ApiService.sendLandmarks()
    }
  }

  // ========== EXTRACT ONLY COORDINATES (x, y, z) ==========
  extractLandmarks(results) {
    // Helper: extracts x, y, z from each landmark
    const extract = (landmarks) => {
      if (!landmarks) return null;
      return landmarks.map(lm => ({ 
        x: lm.x, 
        y: lm.y, 
        z: lm.z 
        // Note: 'visibility' discarded to reduce JSON payload size
      }));
    };

    // Return normalized structure
    return {
      pose: extract(results.poseLandmarks),           // 33 landmarks
      leftHand: extract(results.leftHandLandmarks),   // 21 landmarks
      rightHand: extract(results.rightHandLandmarks)  // 21 landmarks
    };
  }
}
```

### **Canvas Visualization**

```
┌─────────────────────────────────────────┐
│         CANVAS (640x480)                │
├─────────────────────────────────────────┤
│                                         │
│  ● (head, cyan)                         │
│  │ │ (pose connectors, cyan)            │
│  ○─○ (shoulders)                        │
│  │ │ │ (extended arms)                  │
│ ✓   ✓ (hands, purple with fingers)      │
│                                         │
└─────────────────────────────────────────┘

Colors:
• Pose:     CYAN (#00f3ff)    - main skeleton
• Hands:    PURPLE (#9d4edd)  - fingers and palm
• Points:   WHITE (#ffffff)   - individual joints
```

---

## 🔐 SERVICE #3: AuthService.js (Supabase Auth)

```javascript
export class AuthService {
  async login(email, password) {
    // Authenticates user and obtains JWT token
  }

  async register(email, password, fullName) {
    // Registers new user
  }

  async resetPassword(email) {
    // Sends password reset email
  }

  async logout() {
    // Logs out current session
  }

  async getSession() {
    // Retrieves active user session
  }

  onAuthStateChange(callback) {
    // Subscribe to authentication state changes
  }
}
```

---

## CONTEXT: ThemeContext.jsx

```javascript
// Global context for dark/light theme
const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    // Retrieve from localStorage or fallback to system preference
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches 
      ? 'dark' 
      : 'light';
  });

  useEffect(() => {
    // Apply theme to document
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
```

**Usage in components**:

```javascript
const MyComponent = () => {
  const { theme, toggleTheme } = useTheme();
  return <button onClick={toggleTheme}>Toggle Theme</button>;
};
```

---

## 🎯 ROUTING (React Router V7)

### **App.jsx**

```javascript
function App() {
  return (
    <ThemeProvider>
      <Router>
        <div className="bg-blob blob-1"></div>  {/* Background decoration */}
        <div className="bg-blob blob-2"></div>  {/* Background decoration */}
        
        <Navbar />  {/* Fixed header */}
        
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
```

---

## 🧵 COMPLETE LIFECYCLE (Flowchart)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. APP LOADS (index.html → main.jsx → App.jsx)                  │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 2. ThemeProvider wraps entire app (theme context)               │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 3. Router loads initial route (/ = Home)                         │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 4. Navbar rendered (fixed at top)                               │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 5. User navigates to /translator (button click)                 │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 6. Translator.jsx mounts (useEffect with [])                    │
├─────────────────────────────────────────────────────────────────┤
│   • Connects WebSocket                                          │
│   • Initializes MediaPipeEngine                                 │
│   • Starts camera capture                                       │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 7. REAL-TIME LOOP                                               │
├─────────────────────────────────────────────────────────────────┤
│   Every 66ms (15 FPS):                                          │
│   • Camera captures frame                                       │
│   • Holistic processes frame                                    │
│   • onResults() extracts landmarks                              │
│   • sendLandmarks() → WebSocket → Backend                       │
│   • Backend processes and returns translation                   │
│   • onMessage() → setTranslation() → UI updates                 │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 8. User navigates away or reloads page                          │
└─────────────────────────────────────────────────────────────────┘
                               ⬇
┌─────────────────────────────────────────────────────────────────┐
│ 9. CLEANUP (useEffect return callback)                          │
├─────────────────────────────────────────────────────────────────┤
│   • Closes WebSocket                                            │
│   • Stops camera                                                │
│   • Cleans up refs                                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## STYLING SYSTEM

### **CSS Variables (`index.css` + `App.css`)**

```css
:root {
  /* Light theme (default) */
  --text: #6b6375;           /* Main text */
  --text-h: #08060d;         /* Headings */
  --bg: #fff;                /* Background */
  --border: #e5e4e7;         /* Borders */
  --accent: #aa3bff;         /* Primary color (purple) */
  --accent-bg: rgba(170, 59, 255, 0.1);
  --accent-border: rgba(170, 59, 255, 0.5);
  
  --sans: system-ui, 'Segoe UI', Roboto, sans-serif;
  font-size: 18px;
  line-height: 145%;
}

@media (prefers-color-scheme: dark) {
  :root {
    /* Dark theme */
    --text: #9ca3af;
    --text-h: #f3f4f6;
    --bg: #16171d;
    --border: #2e303a;
    --accent: #c084fc;
  }
}
```

### **Reusable Classes**

```css
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
  /* Glassmorphism effect */
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
```

---

## GLOBAL STATE (Without Redux/Zustand)

The app uses **React Context API** for minimal global state:

- **ThemeContext**: dark/light theme

**Why not Redux?**

- App scope is small and component trees are shallow
- Context API is sufficient for this use case
- Less boilerplate, easier to maintain

---

## HOOKS USED

| Hook | Where | Purpose |
| --- | --- | --- |
| `useState` | All components | Manage local component state |
| `useEffect` | Translator.jsx | Initialize and cleanup services |
| `useRef` | Translator.jsx | Direct DOM / instance access |
| `useContext` | ThemeToggle.jsx | Access ThemeContext |
| `useLocation` | Navbar.jsx | Detect active route |

---

## BUILD & DEPLOY

### **Local Development**

```bash
cd expresat/frontend
npm install
npm run dev
# Access at http://localhost:5173
```

### **Production**

```bash
npm run build  # Generates /dist
# Deploy /dist to Netlify (automated via netlify.toml)
```

### **Linting**

```bash
npm run lint  # Oxlint (faster than ESLint)
```

---

## RESPONSIVE DESIGN

```css
/* Mobile-first */
@media (max-width: 768px) {
  .desktop-only { display: none; }
  .mobile-only { display: inline-flex; }
  
  .container {
    padding: 1rem;
  }
  
  [style*="grid"] {
    grid-template-columns: 1fr; /* Vertical stacking */
  }
}
```

---

## EXTERNAL INTEGRATIONS

| Service | Usage | Reference |
| --- | --- | --- |
| **Supabase** | Auth (login/signup) | authService.js |
| **MediaPipe** | Landmark detection | mediapipeEngine.js (CDN) |
| **Lucide React** | UI Icons | Components, Pages |
| **React Router** | Navigation | App.jsx |

---

## KEY FRONTEND DECISIONS

1. **WebSocket instead of HTTP**: Required for low-latency real-time streaming
2. **MediaPipe CDN instead of npm**: Pre-compiled version loaded from CDN to avoid WASM bundler complexities
3. **Stream mode + buffer**: Frontend streams frame by frame; backend buffers 15 frames
4. **Canvas instead of visible video**: Greater visual control (draws overlay landmarks)
5. **React without TypeScript**: Fast prototype development
6. **Simple Context instead of Redux**: Small app scale does not justify extra complexity

---

## CRITICAL POINTS FOR THE AGENT

1. **Translator.jsx is the main page** - core functionality lives here
2. **MediaPipeEngine handles capture** - 15 FPS throttled
3. **ApiService handles WebSocket** - stream mode (frame by frame)
4. **Backend accumulates 15 frames before inference** - transparent to client
5. **Minimal React state**: translation, status, fps
6. **Refs (not state) used for**: video, canvas, engine, api
7. **useEffect [] = single initialization** - cleanup stops camera and WebSocket
8. **CSS Variables styling** - dynamic dark/light theme
9. **Authentication not fully implemented** - uses 'mock_token' for now
10. **Glassmorphism UI** - backdrop-filter blur, rgba translucent colors
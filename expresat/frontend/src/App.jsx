import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Home from './pages/Home';
import Translator from './pages/Translator';
import Learn from './pages/Learn';
import About from './pages/About';
import Auth from './pages/Auth';
import { ThemeProvider } from './context/ThemeContext';

function App() {
  return (
    <ThemeProvider>
      <Router>
        {/* Background Blobs for Glassmorphism aesthetic */}
        <div className="bg-blob blob-1"></div>
        <div className="bg-blob blob-2"></div>
        
        <Navbar />
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/translator" element={<Translator />} />
            <Route path="/learn" element={<Learn />} />
            <Route path="/about" element={<About />} />
            <Route path="/auth" element={<Auth />} />
          </Routes>
        </main>
        <Footer />
      </Router>
    </ThemeProvider>
  );
}

export default App;

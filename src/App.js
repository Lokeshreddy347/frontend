import React, { useState, useEffect, useRef } from 'react';
import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
import axios from 'axios';
import './App.css'; 

// CRITICAL: Connects the PDF parser worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

const indianLanguages = [
  { name: "Telugu", native: "తెలుగు", code: "te" },
  { name: "Hindi", native: "हिन्दी", code: "hi" },
  { name: "Tamil", native: "தமிழ்", code: "ta" },
  { name: "Kannada", native: "ಕನ್ನಡ", code: "kn" },
  { name: "Malayalam", native: "മലയാളം", code: "ml" },
  { name: "Bengali", native: "বাংলা", code: "bn" },
  { name: "Gujarati", native: "ગુજરાતી", code: "gu" },
  { name: "English", native: "English", code: "en" }
];

function App() {
  const [showSplash, setShowSplash] = useState(true);
  
  const [uploadedFile, setUploadedFile] = useState(null); 
  const [extractedText, setExtractedText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [targetLang, setTargetLang] = useState("te"); 
  const [history, setHistory] = useState([]);
  
  const [appState, setAppState] = useState("idle"); 
  const [displayedText, setDisplayedText] = useState("");
  const [scanProgress, setScanProgress] = useState(0);
  const [copySuccess, setCopySuccess] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [isTypingComplete, setIsTypingComplete] = useState(false);
  
  // NEW: State to control whether the History screen is open
  const [showHistory, setShowHistory] = useState(false);
  
  const imageInputRef = useRef(null);
  const pdfInputRef = useRef(null);

  useEffect(() => {
    setTimeout(() => setShowSplash(false), 2500);
    const savedHistory = JSON.parse(localStorage.getItem('translamate_history')) || [];
    setHistory(savedHistory);
  }, []);

  useEffect(() => {
    if (appState === "done" && translatedText) {
      let i = 0;
      setDisplayedText("");
      setIsTypingComplete(false); 
      
      const intervalId = setInterval(() => {
        setDisplayedText((prev) => prev + translatedText.charAt(i));
        i++;
        if (i >= translatedText.length) {
          clearInterval(intervalId);
          setIsTypingComplete(true); 
        }
      }, 30); 
      return () => clearInterval(intervalId);
    }
  }, [translatedText, appState]);

  const saveToHistory = (text, langCode) => {
    const newItem = { text, lang: langCode, time: new Date().toLocaleTimeString() };
    const newHistory = [newItem, ...history].slice(0, 5);
    setHistory(newHistory);
    localStorage.setItem('translamate_history', JSON.stringify(newHistory));
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const isPdf = file.type.includes("pdf") || file.name.toLowerCase().endsWith(".pdf");
      
      setUploadedFile({
        url: URL.createObjectURL(file),
        name: file.name,
        type: isPdf ? 'pdf' : 'image'
      });
      
      setTranslatedText("");
      setDisplayedText("");
      setScanProgress(0); 
      setCopySuccess(false);
      setAudioUrl(null);
      setIsTypingComplete(false);

      if (isPdf) {
        extractPdfText(file);
      } else {
        extractImageText(file);
      }
    }
    event.target.value = null; 
  };

  const extractImageText = (file) => {
    setAppState("scanning");
    Tesseract.recognize(file, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          setScanProgress(Math.round(m.progress * 100)); 
        }
      }
    })
      .then(({ data: { text } }) => {
        setExtractedText(text);
        setAppState("ready");
      })
      .catch((err) => {
        console.error(err);
        setExtractedText("Failed to read image text.");
        setAppState("idle");
      });
  };

  const extractPdfText = async (file) => {
    setAppState("scanning");
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = "";

      for (let i = 1; i <= pdf.numPages; i++) {
        setScanProgress(Math.round((i / pdf.numPages) * 100)); 
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(" ");
        fullText += pageText + "\n";
      }

      if (!fullText.trim()) {
         setExtractedText("This PDF contains only images. Please screenshot the page and upload it as an image.");
      } else {
         setExtractedText(fullText.trim());
      }
      setAppState("ready");
    } catch (error) {
      console.error("PDF extraction error:", error);
      setExtractedText("Failed to read PDF file.");
      setAppState("idle");
    }
  };

  const handleTranslate = async () => {
    if (!extractedText) return;
    setAppState("translating");
    try {
      const response = await axios.post("http://localhost:8000/translate", {
        text: extractedText,
        dest: targetLang,
        mode: "translate"
      });
      setTranslatedText(response.data.translated_text);
      saveToHistory(response.data.translated_text, targetLang);
      setAppState("done");
    } catch (error) {
      console.error("Translation error:", error);
      setTranslatedText("Error connecting to local server.");
      setAppState("done");
    }
  };

  const handleSpeak = async () => {
    if (!translatedText) return;
    setAppState("generating_audio"); 
    try {
      const response = await axios.post("http://localhost:8000/speak", {
        text: translatedText,
        lang: targetLang
      }, { responseType: 'blob' });

      const newAudioUrl = URL.createObjectURL(response.data);
      setAudioUrl(newAudioUrl);
      setAppState("done"); 
    } catch (error) {
      console.error("Audio error:", error);
      setAppState("done");
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(translatedText).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000); 
    });
  };

  const resetApp = () => {
    setUploadedFile(null);
    setAppState("idle");
    setAudioUrl(null);
    setIsTypingComplete(false);
    setShowHistory(false); // Also close history if we go back
  };

  const triggerImagePicker = () => imageInputRef.current.click();
  const triggerPdfPicker = () => pdfInputRef.current.click();

  if (showSplash) {
    return (
      <div className="splash-screen">
        <h1 className="splash-logo">TranslaMate AI</h1>
        <p>Loading neural engines...</p>
      </div>
    );
  }

  return (
    <div className="living-background">
      <input 
        type="file" 
        accept="image/png, image/jpeg, image/jpg" 
        ref={imageInputRef} 
        onChange={handleFileUpload} 
        style={{ display: 'none' }} 
      />
      <input 
        type="file" 
        accept="application/pdf" 
        ref={pdfInputRef} 
        onChange={handleFileUpload} 
        style={{ display: 'none' }} 
      />

      {!uploadedFile ? (
        <div className="idle-container">
          
          {/* NEW LOGIC: Toggle between History View and Main Menu */}
          {showHistory ? (
            
            /* --- THE HISTORY SCREEN --- */
            <div className="glass-panel" style={{ width: '90%', maxWidth: '500px', margin: '0 auto' }}>
              <button 
                onClick={() => setShowHistory(false)} 
                style={{ background: 'transparent', border: 'none', color: '#ff6b6b', fontSize: '1.2rem', fontWeight: '700', marginBottom: '15px', cursor: 'pointer' }}
              >
                ← Back
              </button>
              
              <h2 style={{ margin: '0 0 20px 0', color: '#2f3542', fontSize: '1.8rem' }}>Recent History</h2>
              
              {history.length > 0 ? (
                history.map((item, index) => (
                  <div key={index} className="history-item">
                    <span style={{ maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.text}</span>
                    <span style={{ color: '#ff6b6b' }}>{item.lang.toUpperCase()}</span>
                  </div>
                ))
              ) : (
                <div style={{ padding: '30px 0', textAlign: 'center' }}>
                  <h1 style={{ fontSize: '3rem', margin: '0 0 10px 0' }}>📭</h1>
                  <p style={{ color: '#a4b0be', fontWeight: '600', fontSize: '1.1rem' }}>No translations yet!</p>
                </div>
              )}
            </div>

          ) : (

            /* --- THE MAIN MENU SCREEN --- */
            <>
              <h2 style={{ marginBottom: '40px', fontWeight: '700', color: '#2f3542', fontSize: '2rem' }}>Choose Input</h2>

              <div style={{ display: 'flex', gap: '30px', justifyContent: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <button className="pulse-btn" onClick={triggerImagePicker} style={{ width: '110px', height: '110px', fontSize: '3rem' }}>
                    📷
                  </button>
                  <p style={{ fontWeight: '700', color: '#57606f', marginTop: '15px', fontSize: '1.2rem' }}>Image</p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <button className="pulse-btn" onClick={triggerPdfPicker} style={{ width: '110px', height: '110px', fontSize: '3rem', background: '#48dbfb', boxShadow: '0 12px 0 #0abde3, 0 20px 25px rgba(10, 189, 227, 0.4)' }}>
                    📄
                  </button>
                  <p style={{ fontWeight: '700', color: '#57606f', marginTop: '15px', fontSize: '1.2rem' }}>PDF</p>
                </div>
              </div>

              {/* NEW: The Gamified History Button */}
              <button 
                onClick={() => setShowHistory(true)}
                style={{
                  marginTop: '50px',
                  padding: '15px 30px',
                  background: '#f1f2f6',
                  border: '3px solid #dfe4ea',
                  borderRadius: '20px',
                  color: '#57606f',
                  fontSize: '1.1rem',
                  fontWeight: '700',
                  cursor: 'pointer',
                  boxShadow: '0 6px 0 #dfe4ea',
                  transition: 'all 0.1s'
                }}
                onMouseDown={(e) => { e.currentTarget.style.transform = 'translateY(6px)'; e.currentTarget.style.boxShadow = '0 0 0 #dfe4ea'; }}
                onMouseUp={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 6px 0 #dfe4ea'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 6px 0 #dfe4ea'; }}
              >
                📜 View History
              </button>
            </>
          )}

        </div>
      ) : (
        <div className="active-ui">
          <button onClick={resetApp} style={{ background: 'transparent', border: 'none', color: '#ff6b6b', fontSize: '1.2rem', fontWeight: '700', marginBottom: '15px', cursor: 'pointer' }}>
            ← Back to Home
          </button>

          <div className="glass-panel" style={{ textAlign: 'center' }}>
            {uploadedFile.type === 'image' ? (
              <img src={uploadedFile.url} alt="Scanned Document" style={{ maxHeight: '300px', objectFit: 'contain' }} />
            ) : (
              <div style={{ background: '#f1f2f6', padding: '40px 20px', borderRadius: '20px', border: '4px dashed #dfe4ea' }}>
                <h1 style={{ fontSize: '4rem', margin: '0 0 10px 0' }}>📑</h1>
                <h3 style={{ color: '#2f3542', margin: 0, wordBreak: 'break-all' }}>{uploadedFile.name}</h3>
                <p style={{ color: '#a4b0be', fontWeight: '600' }}>PDF Loaded Successfully</p>
              </div>
            )}
          </div>

          <div className="glass-panel">
            {appState === "scanning" && <div className="status-badge">🔍 Extracting text: {scanProgress}%</div>}
            {appState === "ready" && <div className="status-badge" style={{color: '#0abde3', borderColor: '#0abde3'}}>✅ Text Extracted</div>}
            
            <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem', color: '#a4b0be' }}>Extracted Text:</h3>
            <p style={{ fontSize: '1rem', lineHeight: '1.5', color: '#57606f', fontWeight: '600', maxHeight: '150px', overflowY: 'auto' }}>
              {appState === "scanning" ? "Analyzing document..." : extractedText}
            </p>
          </div>

          <div className="glass-panel">
            <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
              {indianLanguages.map((lang) => (
                <option key={lang.code} value={lang.code}>{lang.name} ({lang.native})</option>
              ))}
            </select>
            <button className="action-btn" onClick={handleTranslate} disabled={appState === "scanning" || appState === "translating"}>
              {appState === "translating" ? "🧠 LLM Processing..." : "Translate Document"}
            </button>
          </div>

          {appState === "done" && (
            <div className="glass-panel" style={{ borderBottomColor: '#0abde3' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#ff6b6b' }}>AI Translation:</h3>
                
                <button 
                  onClick={copyToClipboard} 
                  style={{ background: '#f1f2f6', border: 'none', color: '#57606f', borderRadius: '10px', padding: '8px 12px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: '700' }}
                >
                  {copySuccess ? "✅ Copied!" : "📋 Copy"}
                </button>
              </div>
              
              <p style={{ fontSize: '1.3rem', lineHeight: '1.6', color: '#2f3542', fontWeight: '600' }}>
                {displayedText}
                {!isTypingComplete && <span className="cursor"></span>}
              </p>
              
              {isTypingComplete && (
                <div style={{ marginTop: '20px' }}>
                  {audioUrl ? (
                    <div style={{ background: '#f1f2f6', padding: '15px', borderRadius: '15px', border: '3px solid #dfe4ea' }}>
                      <p style={{ margin: '0 0 10px 0', fontSize: '0.95rem', color: '#10ac84', textAlign: 'center', fontWeight: '700' }}>
                        ✅ Audio Synthesized Successfully
                      </p>
                      <audio src={audioUrl} controls autoPlay style={{ width: '100%', height: '40px', outline: 'none' }} />
                    </div>
                  ) : (
                    <button className="audio-btn" onClick={handleSpeak} style={{ width: '100%' }}>
                      🔊 Generate AI Speech
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Bot, User, Loader2, ExternalLink, ShieldCheck, X, LayoutDashboard, LogIn, LogOut, Mic, MicOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getChatResponse, getGreeting, Message } from './services/geminiService';
import { cn } from './lib/utils';
import { db, auth } from './firebase';
import { doc, setDoc, updateDoc, arrayUnion, Timestamp, getDoc } from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User as FirebaseUser } from 'firebase/auth';
import { v4 as uuidv4 } from 'uuid';
import Dashboard from './components/Dashboard';
import { logErrorToFirebase } from './services/loggingService';

const ADMIN_EMAIL = "info@heatshieldings.com";

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGreetingLoading, setIsGreetingLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId] = useState(() => uuidv4());
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [showDashboard, setShowDashboard] = useState(false);
  const [isPathAdmin, setIsPathAdmin] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      setIsSupported(true);
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = navigator.language || 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(prev => prev + (prev ? ' ' : '') + transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      try {
        recognitionRef.current?.start();
        setIsListening(true);
      } catch (error) {
        console.error('Failed to start speech recognition:', error);
      }
    }
  };

  // Handle resizing when open/closed in iframe
  useEffect(() => {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'CHAT_STATE', isOpen }, '*');
    }
  }, [isOpen]);

  const isAdmin = currentUser?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase(); // Auth check

  useEffect(() => {
    // Check if we should be in admin mode
    const checkAdminPath = () => {
      const params = new URLSearchParams(window.location.search);
      const isExplicitAdmin = window.location.pathname === '/admin' || 
                              params.get('view') === 'admin' || 
                              params.has('admin') || 
                              window.location.hash === '#admin';
      
      if (isExplicitAdmin) {
        setIsPathAdmin(true);
        setIsOpen(false); 
      }
    };

    checkAdminPath();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log("Auth state change:", user?.email);
      setCurrentUser(user);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Auto-show dashboard if on admin path and authenticated
  useEffect(() => {
    if (isPathAdmin && isAdmin) {
      setShowDashboard(true);
    }
  }, [isPathAdmin, isAdmin]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Initialize chat session and greeting
  useEffect(() => {
    const initGreeting = async () => {
      try {
        const greetingText = await getGreeting();
        setMessages([{ role: 'model', text: greetingText }]);
        setIsGreetingLoading(false);
        
        // Notify parent that we are ready
        if (window.parent) {
          window.parent.postMessage({ type: 'WIDGET_READY' }, '*');
        }
      } catch (error) {
        console.error("Greeting initialization error:", error);
        setMessages([{ role: 'model', text: "Hallo! Hoe kan ik je vandaag helpen?" }]);
        setIsGreetingLoading(false);
      }
    };
    initGreeting();
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const currentInput = input; // Capture current input
    const userMessage: Message = { role: 'user', text: currentInput };
    const newMessages = [...messages, userMessage];
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    console.log("Starting handleSend for session:", sessionId);

    const logToFirestore = async () => {
      try {
        const sessionDoc = doc(db, 'chats', sessionId);
        const now = Timestamp.now();
        const sessionExists = messages.length > 1;

        const sessionData: any = {
          lastUpdateTime: now,
          detectedLanguage: navigator.language || 'en',
          userAgent: navigator.userAgent,
          messages: arrayUnion(...(!sessionExists && messages[0]?.role === 'model' 
            ? [
                { role: 'model', text: messages[0].text, timestamp: now },
                { role: 'user', text: currentInput, timestamp: now, language: navigator.language || 'en' }
              ]
            : [
                { role: 'user', text: currentInput, timestamp: now, language: navigator.language || 'en' }
              ]
          ))
        };

        if (!sessionExists) {
          sessionData.startTime = now;
        }

        await setDoc(sessionDoc, sessionData, { merge: true });
        console.log("Chat saved successfully.");
      } catch (error) {
        console.error("Firestore logging failed:", error);
        logErrorToFirebase("HS-DB-001", "Chat Session Save Failed", error);
      }
    };

    // Run logging in background
    logToFirestore();

    console.log("Getting AI response...");
    try {
      const response = await getChatResponse(currentInput, newMessages);
      console.log("AI response received:", response.text.substring(0, 50) + "...");
      setMessages(prev => [...prev, response]);

      // Log model response to Firestore in background
      const logModelResponse = async () => {
        try {
          const sessionDoc = doc(db, 'chats', sessionId);
          await setDoc(sessionDoc, {
            lastUpdateTime: Timestamp.now(),
            messages: arrayUnion({
              role: 'model',
              text: response.text,
              timestamp: Timestamp.now()
            })
          }, { merge: true });
        } catch (error) {
          console.error("Failed to log model response:", error);
          logErrorToFirebase("HS-DB-002", "AI Response Log Failed", error);
        }
      };
      
      logModelResponse();
    } catch (error) {
      console.error("General AI error:", error);
      setMessages(prev => [...prev, { 
        role: 'model', 
        text: "Sorry, er ging iets mis bij het verwerken van je vraag. Probeer het later opnieuw." 
      }]);
    } finally {
      console.log("handleSend finished, clearing loading state.");
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    // Force account selection so users can switch to the admin account if needed
    provider.setCustomParameters({ prompt: 'select_account' });
    
    try {
      const result = await signInWithPopup(auth, provider);
      console.log("Logged in as:", result.user.email);
      // Automatically show dashboard if the logging in user is the admin
      if (result.user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        setShowDashboard(true);
        // We stay on the admin path but now isAdmin is true
      } else {
        alert(`Toegang geweigerd: ${result.user.email} is geen geautoriseerde beheerder.`);
      }
    } catch (error: any) {
      console.error("Login Error:", error);
      const currentDomain = window.location.hostname;
      if (error.code === 'auth/unauthorized-domain') {
        alert(
          `Fout: Dit domein (${currentDomain}) is niet geautoriseerd in de Firebase Console.\n\n` +
          `STAPPEN OM DIT OP TE LOSSEN:\n` +
          `1. Ga naar de Firebase Console > Authentication > Settings > Authorized Domains.\n` +
          `2. Klik op 'Add domain'.\n` +
          `3. Voeg exact toe: ${currentDomain}\n` +
          `4. Controleer ook of je de 'Support email' hebt ingesteld op de Sign-in method tab.`
        );
      } else if (error.code === 'auth/popup-blocked') {
        alert("Fout: De login popup werd geblokkeerd. Sta popups toe voor deze site.");
      } else {
        alert("Er is een fout opgetreden bij het inloggen: " + (error.message || "Onbekende fout"));
      }
    }
  };

  const handleFirestoreError = (error: any, operationType: string, path: string | null) => {
    const errInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        providerInfo: auth.currentUser?.providerData.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
        })) || []
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    logErrorToFirebase("HS-DB-999", `Firestore ${operationType} failed`, error);
    return errInfo;
  };

  // If on /admin path and not logged in as admin, show a full-screen login
  useEffect(() => {
    // Parent notification removed to avoid potential reload loops in preview
  }, [showDashboard, isOpen]);

  if (isAuthLoading) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center p-4 z-[300]">
        <Loader2 size={48} className="animate-spin text-brand-primary mb-4" />
        <p className="text-white text-sm font-medium animate-pulse">Authenticatie controleren...</p>
      </div>
    );
  }

  if (isPathAdmin && !isAdmin) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center p-4 z-[200]">
        <div className="bg-white w-full max-w-md p-8 rounded-2xl shadow-2xl text-center">
          <div className="w-16 h-16 bg-brand-primary rounded-2xl flex items-center justify-center mx-auto mb-6 text-white shadow-lg">
            <ShieldCheck size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Admin Toegang</h1>
          <p className="text-slate-500 mb-8">Log in met je geautoriseerde Google-account om het dashboard te openen.</p>
          
          {currentUser ? (
            <div className="space-y-4">
              <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
                Toegang Geweigerd. Je account ({currentUser.email}) is niet geautoriseerd.
              </div>
              <button
                onClick={() => signOut(auth)}
                className="w-full py-3 bg-slate-100 text-slate-600 rounded-xl font-medium hover:bg-slate-200 transition-colors"
              >
                Uitloggen
              </button>
            </div>
          ) : (
            <button
              onClick={handleLogin}
              className="w-full py-3 bg-brand-primary text-white rounded-xl font-medium hover:bg-orange-600 transition-colors flex items-center justify-center gap-2 shadow-lg"
            >
              <LogIn size={20} />
              Inloggen met Google
            </button>
          )}
          
          <button 
            onClick={() => {
              setIsPathAdmin(false);
              setShowDashboard(false);
              setIsOpen(true);
              // Clean up URL if possible (optional)
              window.history.replaceState({}, document.title, "/");
            }} 
            className="block w-full mt-8 text-sm text-slate-400 hover:text-slate-600 transition-colors"
          >
            Terug naar Chat
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "h-screen w-full bg-transparent flex flex-col items-end justify-end",
      isOpen || showDashboard ? "p-0 sm:p-4" : "p-0",
      !isOpen && !showDashboard && "pointer-events-none"
    )}>
      {showDashboard && isAdmin && (
        <Dashboard onClose={() => setShowDashboard(false)} />
      )}

      {/* Floating Chat Button (if closed) */}
      {!isOpen && (
        <motion.button
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          onClick={() => setIsOpen(true)}
          className="w-16 h-16 bg-brand-primary rounded-full shadow-2xl flex items-center justify-center text-white hover:bg-orange-600 transition-all z-50 pointer-events-auto mb-4 mr-4"
        >
          <Bot size={32} />
        </motion.button>
      )}

      {/* Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="w-full max-w-lg h-full max-h-[700px] bg-white/90 backdrop-blur-xl rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] flex flex-col overflow-hidden border border-white/20 pointer-events-auto"
          >
            {/* Header */}
            <div className="bg-brand-secondary/95 backdrop-blur-md p-4 flex items-center justify-between text-white shadow-sm ring-1 ring-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-brand-primary rounded-lg flex items-center justify-center shadow-lg shadow-brand-primary/20">
                  <ShieldCheck size={24} />
                </div>
                <div>
                  <h1 className="font-semibold text-lg leading-tight tracking-tight">HeatShieldings AI</h1>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-slate-400 font-medium">Product Expert</p>
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-white/10 rounded-full transition-all hover:rotate-90 duration-200"
              >
                <X size={20} />
              </button>
            </div>

            {/* Messages Area */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth bg-transparent"
            >
              {isGreetingLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 size={32} className="animate-spin text-brand-primary opacity-20" />
                </div>
              ) : (
                <>
                  {messages.map((msg, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: msg.role === 'user' ? 20 : -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={cn(
                        "flex gap-3 max-w-[85%]",
                        msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
                      )}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1",
                        msg.role === 'user' ? "bg-brand-primary text-white" : "bg-slate-100 text-brand-secondary"
                      )}>
                        {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                      </div>
                      <div className="space-y-2">
                        <div className={cn(
                          "p-4 rounded-2xl text-sm leading-relaxed",
                          msg.role === 'user' 
                            ? "bg-brand-primary text-white rounded-tr-none" 
                            : "bg-slate-50 text-slate-800 border border-slate-100 rounded-tl-none"
                        )}>
                          <div className="prose prose-sm max-w-none prose-slate prose-a:text-brand-primary prose-a:no-underline hover:prose-a:underline">
                            <ReactMarkdown 
                              remarkPlugins={[remarkGfm]}
                              components={{
                                a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />
                              }}
                            >
                              {msg.text}
                            </ReactMarkdown>
                          </div>
                        </div>
                        
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-4">
                            {msg.sources.map((source, sIdx) => (
                              <a
                                key={sIdx}
                                href={source}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] bg-slate-100 text-slate-500 px-2 py-1 rounded border border-slate-200 hover:bg-slate-200 transition-colors flex items-center gap-2"
                              >
                                <ExternalLink size={10} />
                                Bron {sIdx + 1}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                  
                  {isLoading && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex gap-3 mr-auto"
                    >
                      <div className="w-8 h-8 rounded-full bg-slate-100 text-brand-secondary flex items-center justify-center shrink-0">
                        <Bot size={16} />
                      </div>
                      <div className="bg-slate-50 p-4 rounded-2xl rounded-tl-none border border-slate-100">
                        <Loader2 size={18} className="animate-spin text-brand-primary" />
                      </div>
                    </motion.div>
                  )}
                </>
              )}
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-white/10 bg-white/40 backdrop-blur-md">
              <form 
                onSubmit={(e) => { e.preventDefault(); handleSend(); }}
                className="relative flex items-center"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Stel een vraag over hitteschilden..."
                  className="w-full bg-white/80 border border-slate-200/50 rounded-xl py-3 pl-4 pr-24 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-all shadow-sm"
                />
                <div className="absolute right-2 flex items-center gap-1">
                  {isSupported && (
                    <button
                      type="button"
                      onClick={toggleListening}
                      className={cn(
                        "p-2 rounded-lg transition-colors",
                        isListening 
                          ? "bg-red-500 text-white animate-pulse" 
                          : "text-slate-400 hover:bg-slate-100"
                      )}
                      title={isListening ? "Stop listening" : "Start voice input"}
                    >
                      {isListening ? <MicOff size={18} /> : <Mic size={18} />}
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={!input.trim() || isLoading}
                    className="p-2 bg-brand-primary text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:hover:bg-brand-primary transition-colors"
                  >
                    <Send size={18} />
                  </button>
                </div>
              </form>
              <p className="text-[10px] text-center text-slate-400 mt-6">
                Mogelijk gemaakt door Google AI • Antwoorden gebaseerd op HeatShieldings.com kennis
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Bot, User, Loader2, ExternalLink, ShieldCheck, X, LayoutDashboard, LogIn, LogOut, Mic, MicOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { getChatResponse, getGreeting, Message } from './services/geminiService';
import { cn } from './lib/utils';
import { db, auth } from './firebase';
import { doc, setDoc, updateDoc, arrayUnion, Timestamp, getDoc } from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User as FirebaseUser } from 'firebase/auth';
import { v4 as uuidv4 } from 'uuid';
import Dashboard from './components/Dashboard';

const ADMIN_EMAIL = "info@heatshieldings.com";

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGreetingLoading, setIsGreetingLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId] = useState(() => uuidv4());
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
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

  useEffect(() => {
    // Check if we are on the /admin path or have ?view=admin query param
    const params = new URLSearchParams(window.location.search);
    if (window.location.pathname === '/admin' || params.get('view') === 'admin') {
      setIsPathAdmin(true);
      setShowDashboard(true);
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubscribe();
  }, []);

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
        setMessages([{ role: 'model', text: "Hello! How can I help you today?" }]);
        setIsGreetingLoading(false);
      }
    };
    initGreeting();
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', text: input };
    const newMessages = [...messages, userMessage];
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const sessionDoc = doc(db, 'chats', sessionId);
      
      // Check if this is the first message to create the session
      if (messages.length === 1 && messages[0].role === 'model') {
        try {
          await setDoc(sessionDoc, {
            startTime: Timestamp.now(),
            lastUpdateTime: Timestamp.now(),
            messages: [
              {
                role: 'model',
                text: messages[0].text,
                timestamp: Timestamp.now()
              },
              {
                role: 'user',
                text: input,
                timestamp: Timestamp.now(),
                language: navigator.language || 'en'
              }
            ],
            detectedLanguage: navigator.language || 'en',
            userAgent: navigator.userAgent
          });
        } catch (error) {
          handleFirestoreError(error, 'create', `chats/${sessionId}`);
          throw error;
        }
      } else {
        // Log user message to existing Firestore session
        try {
          await updateDoc(sessionDoc, {
            lastUpdateTime: Timestamp.now(),
            messages: arrayUnion({
              role: 'user',
              text: input,
              timestamp: Timestamp.now(),
              language: navigator.language || 'en'
            })
          });
        } catch (error) {
          handleFirestoreError(error, 'update', `chats/${sessionId}`);
          throw error;
        }
      }

      const response = await getChatResponse(input, newMessages);
      setMessages(prev => [...prev, response]);

      // Log model response to Firestore
      try {
        await updateDoc(sessionDoc, {
          lastUpdateTime: Timestamp.now(),
          messages: arrayUnion({
            role: 'model',
            text: response.text,
            timestamp: Timestamp.now()
          })
        });
      } catch (error) {
        handleFirestoreError(error, 'update', `chats/${sessionId}`);
        throw error;
      }
    } catch (error) {
      console.error("Chat logging error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login Error:", error);
    }
  };

  const isAdmin = currentUser?.email === ADMIN_EMAIL;

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
    return errInfo;
  };

  // If on /admin path and not logged in as admin, show a full-screen login
  useEffect(() => {
    if (window.parent) {
      if (showDashboard) {
        window.parent.postMessage({ type: 'DASHBOARD_OPENED' }, '*');
      } else {
        window.parent.postMessage({ type: isOpen ? 'CHAT_OPENED' : 'CHAT_CLOSED' }, '*');
      }
    }
  }, [showDashboard, isOpen]);

  if (isPathAdmin && !isAdmin) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-md p-8 rounded-2xl shadow-2xl text-center">
          <div className="w-16 h-16 bg-brand-primary rounded-2xl flex items-center justify-center mx-auto mb-6 text-white shadow-lg">
            <ShieldCheck size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Admin Access</h1>
          <p className="text-slate-500 mb-8">Please sign in with your authorized Google account to access the dashboard.</p>
          
          {currentUser ? (
            <div className="space-y-4">
              <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
                Access Denied. Your account ({currentUser.email}) is not authorized.
              </div>
              <button
                onClick={() => signOut(auth)}
                className="w-full py-3 bg-slate-100 text-slate-600 rounded-xl font-medium hover:bg-slate-200 transition-colors"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              onClick={handleLogin}
              className="w-full py-3 bg-brand-primary text-white rounded-xl font-medium hover:bg-orange-600 transition-colors flex items-center justify-center gap-2 shadow-lg"
            >
              <LogIn size={20} />
              Sign in with Google
            </button>
          )}
          
          <a href="/" className="block mt-8 text-sm text-slate-400 hover:text-slate-600 transition-colors">
            Back to Chat
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-transparent flex flex-col items-end justify-end p-0 sm:p-4 pointer-events-none">
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
            className="w-full max-w-lg h-full max-h-[700px] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 pointer-events-auto"
          >
            {/* Header */}
            <div className="bg-brand-secondary p-4 flex items-center justify-between text-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-brand-primary rounded-lg flex items-center justify-center">
                  <ShieldCheck size={24} />
                </div>
                <div>
                  <h1 className="font-semibold text-lg leading-tight">HeatShieldings AI</h1>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-slate-400">Product Expert Assistant</p>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => {
                          if (isAdmin) {
                            setShowDashboard(true);
                          } else {
                            handleLogin();
                          }
                        }}
                        className="text-[10px] text-white/40 hover:text-white/80 transition-colors underline"
                      >
                        {isAdmin ? 'Dashboard' : 'Admin'}
                      </button>
                      {currentUser && (
                        <button 
                          onClick={() => signOut(auth)}
                          className="text-[10px] text-white/40 hover:text-white/80 transition-colors underline"
                        >
                          Logout
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Messages Area */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth"
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
                          <div className="prose prose-sm max-w-none prose-slate">
                            <ReactMarkdown>
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
            <div className="p-4 border-t border-slate-100 bg-slate-50/50">
              <form 
                onSubmit={(e) => { e.preventDefault(); handleSend(); }}
                className="relative flex items-center"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about heat shields, wraps, or sleeves..."
                  className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-4 pr-24 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-all shadow-sm"
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
                Powered by Google AI • Answers based on HeatShieldings.com content
                <br />
                <button 
                  onClick={() => {
                    if (isAdmin) {
                      setShowDashboard(true);
                    } else {
                      handleLogin();
                    }
                  }}
                  className="mt-1 hover:text-slate-600 underline"
                >
                  {isAdmin ? 'Back Office Dashboard' : 'Back Office Access'}
                </button>
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

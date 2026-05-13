import { useState, useEffect, useMemo } from 'react';
import { db, auth } from '../firebase';
import { collection, query, orderBy, onSnapshot, Timestamp, doc, deleteDoc } from 'firebase/firestore';
import { format, differenceInMinutes } from 'date-fns';
import { Message } from '../services/geminiService';
import { ChevronRight, ChevronDown, MessageSquare, Clock, Globe, User, Bot, Download, X, BarChart3, TrendingUp, Hash, Users, PieChart, Trash2 } from 'lucide-react';

interface ChatSession {
  id: string;
  startTime: Timestamp;
  lastUpdateTime: Timestamp;
  messages: {
    role: 'user' | 'model';
    text: string;
    timestamp: Timestamp;
    language?: string;
  }[];
  detectedLanguage?: string;
  userAgent?: string;
}

export default function Dashboard({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'chats' | 'stats'>('chats');

  const stats = useMemo(() => {
    if (sessions.length === 0) return null;

    const totalSessions = sessions.length;
    const totalMessages = sessions.reduce((acc, s) => acc + s.messages.length, 0);
    const avgMessages = (totalMessages / totalSessions).toFixed(1);
    
    const durations = sessions.map(s => differenceInMinutes(s.lastUpdateTime.toDate(), s.startTime.toDate()));
    const avgDuration = (durations.reduce((acc, d) => acc + d, 0) / totalSessions).toFixed(1);

    // Topic Analysis (Basic Keyword Extraction)
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'to', 'for', 'with', 'on', 'at', 'by', 'from', 'up', 'about', 'into', 'over', 'after', 'can', 'how', 'what', 'where', 'when', 'why', 'who', 'i', 'my', 'you', 'your', 'it', 'its', 'this', 'that', 'these', 'those', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'can', 'could', 'not', 'no', 'yes', 'so', 'if', 'then', 'else', 'than', 'as', 'until', 'while', 'of', 'in', 'out', 'off', 'again', 'further', 'then', 'once', 'here', 'there', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now']);
    
    const keywords: Record<string, number> = {};
    const questions: Record<string, number> = {};
    const languages: Record<string, number> = {};

    sessions.forEach(s => {
      const lang = s.detectedLanguage || 'en';
      languages[lang] = (languages[lang] || 0) + 1;

      s.messages.forEach(m => {
        if (m.role === 'user') {
          const text = m.text.toLowerCase();
          
          // Question detection
          if (text.endsWith('?') || text.includes('?')) {
            const q = text.trim();
            questions[q] = (questions[q] || 0) + 1;
          }

          // Keyword extraction
          const words = text.replace(/[^\w\s]/g, '').split(/\s+/);
          words.forEach(word => {
            if (word.length > 3 && !stopWords.has(word)) {
              keywords[word] = (keywords[word] || 0) + 1;
            }
          });
        }
      });
    });

    const topKeywords = Object.entries(keywords)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    const topQuestions = Object.entries(questions)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    const topLanguages = Object.entries(languages)
      .sort(([, a], [, b]) => b - a);

    return {
      totalSessions,
      totalMessages,
      avgMessages,
      avgDuration,
      topKeywords,
      topQuestions,
      topLanguages
    };
  }, [sessions]);

  useEffect(() => {
    const q = query(collection(db, 'chats'), orderBy('lastUpdateTime', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ChatSession[];
      setSessions(data);
      setIsLoading(false);
      setError(null);
    }, (err) => {
      console.error("Dashboard Snapshot Error:", err);
      setError(err.message || "Fout bij het laden van de chatsessies. Controleer je rechten.");
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const exportToCSV = () => {
    const headers = ['Session ID', 'Start Time', 'Last Update', 'Language', 'Role', 'Message', 'Timestamp'];
    const rows = sessions.flatMap(session => 
      session.messages.map(msg => [
        session.id,
        format(session.startTime.toDate(), 'yyyy-MM-dd HH:mm:ss'),
        format(session.lastUpdateTime.toDate(), 'yyyy-MM-dd HH:mm:ss'),
        session.detectedLanguage || 'unknown',
        msg.role,
        msg.text.replace(/"/g, '""'),
        format(msg.timestamp.toDate(), 'yyyy-MM-dd HH:mm:ss')
      ])
    );

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `heatshieldings_chats_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const deleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm('Weet je zeker dat je deze chatsessie wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.')) {
      try {
        await deleteDoc(doc(db, 'chats', id));
      } catch (error) {
        console.error("Error deleting session:", error);
        alert("Fout bij het verwijderen van de sessie. Controleer je rechten.");
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 pointer-events-auto">
      <div className="bg-white w-full max-w-5xl h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-slate-800 p-6 flex items-center justify-between text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-primary rounded-lg flex items-center justify-center">
              <BarChart3 size={24} />
            </div>
            <div>
              <h1 className="font-bold text-xl">Chat Analyse Dashboard</h1>
              <p className="text-sm text-slate-400">Analyseer klantinteracties</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex bg-white/10 p-1 rounded-lg mr-4">
              <button
                onClick={() => setActiveTab('chats')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'chats' ? 'bg-white text-slate-900 shadow-sm' : 'text-white hover:bg-white/10'}`}
              >
                Gesprekken
              </button>
              <button
                onClick={() => setActiveTab('stats')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'stats' ? 'bg-white text-slate-900 shadow-sm' : 'text-white hover:bg-white/10'}`}
              >
                Statistieken
              </button>
            </div>
            <button
              onClick={exportToCSV}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg transition-colors text-sm font-medium"
            >
              <Download size={18} />
              Exporteer CSV
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm flex items-center justify-between">
              <p><strong>Fout:</strong> {error}</p>
              <button 
                onClick={() => { setError(null); setIsLoading(true); }}
                className="text-xs underline hover:no-underline"
              >
                Opnieuw proberen
              </button>
            </div>
          )}
          
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary"></div>
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-20 text-slate-500">
              <MessageSquare size={48} className="mx-auto mb-4 opacity-20" />
              <p>Nog geen chatsessies opgenomen.</p>
            </div>
          ) : activeTab === 'stats' && stats ? (
            <div className="space-y-8 max-w-4xl mx-auto">
              {/* Overview Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-3 text-slate-500 mb-2">
                    <Users size={18} />
                    <span className="text-xs font-semibold uppercase tracking-wider">Sessies</span>
                  </div>
                  <div className="text-3xl font-bold text-slate-900">{stats.totalSessions}</div>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-3 text-slate-500 mb-2">
                    <MessageSquare size={18} />
                    <span className="text-xs font-semibold uppercase tracking-wider">Berichten</span>
                  </div>
                  <div className="text-3xl font-bold text-slate-900">{stats.totalMessages}</div>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-3 text-slate-500 mb-2">
                    <Hash size={18} />
                    <span className="text-xs font-semibold uppercase tracking-wider">Gem. Ber/Chat</span>
                  </div>
                  <div className="text-3xl font-bold text-slate-900">{stats.avgMessages}</div>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-3 text-slate-500 mb-2">
                    <Clock size={18} />
                    <span className="text-xs font-semibold uppercase tracking-wider">Gem. Duur</span>
                  </div>
                  <div className="text-3xl font-bold text-slate-900">{stats.avgDuration}m</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Top Topics */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">
                      <TrendingUp size={20} className="text-brand-primary" />
                      Meest Besproken Onderwerpen
                    </h3>
                  </div>
                  <div className="space-y-3">
                    {stats.topKeywords.map(([word, count], idx) => (
                      <div key={word} className="flex items-center gap-4">
                        <span className="text-xs text-slate-400 w-6">{idx + 1}.</span>
                        <div className="flex-1">
                          <div className="flex justify-between text-sm mb-1">
                            <span className="font-medium text-slate-700 capitalize">{word}</span>
                            <span className="text-slate-400">{count} vermeldingen</span>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-brand-primary" 
                              style={{ width: `${(count / stats.topKeywords[0][1]) * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Language Breakdown */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">
                      <PieChart size={20} className="text-brand-primary" />
                      Taalverdeling
                    </h3>
                  </div>
                  <div className="space-y-4">
                    {stats.topLanguages.map(([lang, count]) => (
                      <div key={lang} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-xs font-bold text-slate-600 shadow-sm uppercase">
                            {lang}
                          </div>
                          <span className="text-sm font-medium text-slate-700">
                            {lang === 'en' ? 'Engels' : lang === 'nl' ? 'Nederlands' : lang === 'de' ? 'Duits' : lang === 'fr' ? 'Frans' : lang.toUpperCase()}
                          </span>
                        </div>
                        <div className="text-sm font-bold text-slate-900">
                          {((count / stats.totalSessions) * 100).toFixed(0)}%
                          <span className="text-xs font-normal text-slate-400 ml-2">({count})</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Frequent Questions */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <MessageSquare size={20} className="text-brand-primary" />
                    Veelgestelde Vragen
                  </h3>
                </div>
                <div className="space-y-4">
                  {stats.topQuestions.length > 0 ? stats.topQuestions.map(([q, count]) => (
                    <div key={q} className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-start justify-between gap-4">
                      <p className="text-sm text-slate-700 italic">"{q}"</p>
                      <div className="shrink-0 bg-white px-3 py-1 rounded-full text-xs font-bold text-brand-primary border border-brand-primary/20 shadow-sm">
                        {count} keer
                      </div>
                    </div>
                  )) : (
                    <p className="text-sm text-slate-400 text-center py-4">Nog geen specifieke vragen geïdentificeerd.</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {sessions.map((session) => (
                <div 
                  key={session.id}
                  className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm transition-all hover:shadow-md"
                >
                  <button
                    onClick={() => setExpandedSession(expandedSession === session.id ? null : session.id)}
                    className="w-full p-4 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2 text-slate-600">
                        <Clock size={16} />
                        <span className="text-sm font-medium">
                          {format(session.startTime.toDate(), 'MMM d, HH:mm')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-600">
                        <Globe size={16} />
                        <span className="text-sm uppercase">{session.detectedLanguage || 'EN'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-600">
                        <MessageSquare size={16} />
                        <span className="text-sm">{session.messages.length} berichten</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => deleteSession(e, session.id)}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                        title="Verwijder Chat"
                      >
                        <Trash2 size={18} />
                      </button>
                      {expandedSession === session.id ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                    </div>
                  </button>

                  {expandedSession === session.id && (
                    <div className="p-4 border-t border-slate-100 bg-slate-50/30 space-y-4">
                      <div className="text-[10px] text-slate-400 mb-4 font-mono">
                        Session ID: {session.id} | UA: {session.userAgent}
                      </div>
                      {session.messages.map((msg, mIdx) => (
                        <div 
                          key={mIdx}
                          className={`flex gap-3 ${msg.role === 'user' ? 'flex-row' : 'flex-row-reverse'}`}
                        >
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                            msg.role === 'user' ? 'bg-brand-primary text-white' : 'bg-slate-200 text-slate-600'
                          }`}>
                            {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                          </div>
                          <div className={`max-w-[80%] p-3 rounded-xl text-sm ${
                            msg.role === 'user' 
                              ? 'bg-white border border-slate-200 rounded-tl-none' 
                              : 'bg-slate-800 text-white rounded-tr-none'
                          }`}>
                            <p className="whitespace-pre-wrap">{msg.text}</p>
                            <span className="text-[10px] opacity-50 mt-1 block">
                              {format(msg.timestamp.toDate(), 'HH:mm:ss')}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

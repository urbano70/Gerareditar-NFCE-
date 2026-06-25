import { useState, useEffect, MouseEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Scan, FileText, History, Trash2, Calendar, Store, Sparkles, BookOpen, Clock, 
  HelpCircle, ChevronRight, FileDown, MessageSquare, AlertCircle
} from "lucide-react";
import NFCeScanner from "./components/NFCeScanner";
import NFCeViewer from "./components/NFCeViewer";
import NFCeShare from "./components/NFCeShare";
import { NFCeData } from "./types";

const HISTORY_KEY = "nfce_reader_history";

export default function App() {
  const [parsedData, setParsedData] = useState<NFCeData | null>(null);
  const [sourceType, setSourceType] = useState<string>("");
  const [shareChannel, setShareChannel] = useState<"email" | "whatsapp" | null>(null);
  const [history, setHistory] = useState<Array<{ data: NFCeData; dateAdded: string; sourceType: string }>>([]);

  // Load history on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) {
        setHistory(JSON.parse(saved));
      }
    } catch (e) {
      console.error("Failed to load invoice history:", e);
    }
  }, []);

  // Save history helper
  const saveToHistory = (newData: NFCeData, source: string) => {
    try {
      // Avoid duplicate access keys in recent history
      const filtered = history.filter(
        (item) => item.data.invoice.accessKey !== newData.invoice.accessKey
      );
      const updated = [
        { data: newData, dateAdded: new Date().toISOString(), sourceType: source },
        ...filtered,
      ].slice(0, 10); // Keep only top 10

      setHistory(updated);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error("Failed to save invoice to history:", e);
    }
  };

  // Remove single history item
  const handleRemoveHistoryItem = (accessKey: string, e: MouseEvent) => {
    e.stopPropagation(); // Prevent opening the note
    try {
      const updated = history.filter((item) => item.data.invoice.accessKey !== accessKey);
      setHistory(updated);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    } catch (err) {
      console.error(err);
    }
  };

  // Clear entire history
  const handleClearHistory = () => {
    try {
      setHistory([]);
      localStorage.removeItem(HISTORY_KEY);
    } catch (err) {
      console.error(err);
    }
  };

  // Receive parsed data from scanner
  const handleDataParsed = (data: NFCeData, source: string) => {
    setParsedData(data);
    setSourceType(source);
    saveToHistory(data, source);
  };

  // Receive updated data from editor
  const handleUpdateData = (updatedData: NFCeData) => {
    setParsedData(updatedData);
    // Sync with history
    const updatedHistory = history.map((item) => {
      if (item.data.invoice.accessKey === updatedData.invoice.accessKey) {
        return { ...item, data: updatedData };
      }
      return item;
    });
    setHistory(updatedHistory);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updatedHistory));
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-slate-200 font-sans flex flex-col justify-between selection:bg-emerald-500 selection:text-black" id="main-app-container">
      {/* Global CSS for printing and clean look */}
      <header className="h-20 border-b border-white/10 flex items-center justify-between px-6 sm:px-10 bg-[#0D0D0F] sticky top-0 z-40 print:hidden">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-white">NotaFlow<span className="text-emerald-500 font-light">PDF</span></h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Digitalizador NFC-e Pro</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
            <span className="text-[10px] font-semibold text-emerald-400">SISTEMA PRONTO</span>
          </div>

          {parsedData ? (
            <button
              onClick={() => {
                setParsedData(null);
                setSourceType("");
              }}
              id="btn-header-new-scan"
              className="text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-black py-2 px-4 rounded-xl shadow-xs cursor-pointer transition-colors"
            >
              Escanear Outra Nota
            </button>
          ) : (
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700"></div>
          )}
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 py-8 sm:py-12 max-w-7xl w-full mx-auto px-4 sm:px-6">
        <AnimatePresence mode="wait">
          {!parsedData ? (
            <motion.div
              key="scan-view"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start"
            >
              {/* Left Column: Title and Instructions (Col 1 to 5) */}
              <div className="lg:col-span-5 space-y-8" id="intro-column">
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-emerald-400 font-medium text-[11px]">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Agora com OCR Inteligente (Gemini 3.5)</span>
                  </div>
                  
                  <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
                    Digitalize Notas Fiscais NFC-e em Segundos
                  </h2>
                  
                  <p className="text-sm sm:text-base text-slate-400 leading-relaxed max-w-md">
                    Lê o QR code impresso, extrai os itens da nota diretamente dos portais estaduais da SEFAZ, formata o DANFE e exporta em PDF nítido pronto para enviar por e-mail ou WhatsApp para o seu cliente.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" id="intro-features">
                  <div className="p-4 rounded-2xl bg-[#0F0F12] border border-white/5 flex gap-3 shadow-md">
                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-emerald-400">
                      <Scan className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-200">Leitura QR</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-normal">Câmera ativa ou upload da imagem de qualquer estado brasileiro.</p>
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-[#0F0F12] border border-white/5 flex gap-3 shadow-md">
                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 text-emerald-400">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-200">OCR da Nota</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-normal">Envie a foto do papel e nossa IA detectará os itens fiscais.</p>
                    </div>
                  </div>
                </div>

                {/* Local Storage History Panel */}
                {history.length > 0 && (
                  <div className="space-y-3.5 pt-6 border-t border-white/10" id="recent-history-section">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <History className="w-3.5 h-3.5 text-slate-400" />
                        Notas Recentes ({history.length})
                      </h3>
                      <button
                        onClick={handleClearHistory}
                        id="btn-clear-history"
                        className="text-[10px] text-red-400 hover:text-red-300 font-semibold cursor-pointer"
                      >
                        Limpar Tudo
                      </button>
                    </div>

                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1" id="history-list">
                      {history.map((item, idx) => (
                        <div
                          key={idx}
                          id={`history-item-${idx}`}
                          onClick={() => {
                            setParsedData(item.data);
                            setSourceType(item.sourceType);
                          }}
                          className="p-3 bg-[#0F0F12] hover:bg-[#121215] border border-white/5 hover:border-white/10 rounded-xl flex items-center justify-between transition-all cursor-pointer group shadow-xs"
                        >
                          <div className="flex items-center gap-3 truncate">
                            <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 text-slate-400 group-hover:bg-emerald-500 group-hover:text-black transition-all">
                              <FileText className="w-4 h-4" />
                            </div>
                            <div className="truncate">
                              <span className="text-xs font-bold text-slate-200 group-hover:text-white block truncate">
                                {item.data.issuer.name}
                              </span>
                              <span className="text-[10px] text-slate-500 font-medium flex items-center gap-2">
                                <span>Nº {item.data.invoice.number}</span>
                                <span>•</span>
                                <span className="text-emerald-400 font-semibold">R$ {item.data.totals.total.toFixed(2)}</span>
                              </span>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-1">
                            <span className="text-[9px] px-2 py-0.5 bg-white/5 text-slate-400 font-medium rounded-full uppercase group-hover:bg-white/10">
                              {item.sourceType === "Imagem / Foto" ? "Foto" : "QR Code"}
                            </span>
                            <button
                              id={`btn-remove-history-item-${idx}`}
                              onClick={(e) => handleRemoveHistoryItem(item.data.invoice.accessKey, e)}
                              className="text-slate-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-white/5 transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Active QR and Parser Modules (Col 6 to 12) */}
              <div className="lg:col-span-7 flex justify-center" id="scanner-column">
                <NFCeScanner onDataParsed={handleDataParsed} />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="view-view"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
            >
              {/* Alert status about parser input source */}
              <div className="max-w-5xl mx-auto px-2 sm:px-4 mb-6 print:hidden" id="source-alert">
                <div className="bg-[#0F0F12] border border-white/5 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-md">
                  <div className="flex items-start sm:items-center gap-3">
                    <div className="p-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl shrink-0">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white">
                        Nota Fiscal Digitalizada com Sucesso!
                      </p>
                      <p className="text-[11px] text-slate-400 font-medium">
                        Fonte de importação: <strong className="text-emerald-400 font-semibold uppercase">{sourceType}</strong>. Revise, edite se necessário, e emita seu PDF.
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex gap-2 shrink-0">
                    <button
                      id="btn-alert-whatsapp"
                      onClick={() => setShareChannel("whatsapp")}
                      className="px-3.5 py-1.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 font-semibold rounded-xl border border-emerald-500/20 text-xs transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      WhatsApp
                    </button>
                    <button
                      id="btn-alert-new"
                      onClick={() => {
                        setParsedData(null);
                        setSourceType("");
                      }}
                      className="px-3.5 py-1.5 bg-white text-black hover:bg-slate-200 font-semibold rounded-xl text-xs transition-all cursor-pointer"
                    >
                      Escanear Outra
                    </button>
                  </div>
                </div>
              </div>

              <NFCeViewer
                data={parsedData}
                onUpdateData={handleUpdateData}
                onBack={() => {
                  setParsedData(null);
                  setSourceType("");
                }}
                onOpenShare={(channel) => setShareChannel(channel)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Share Modals */}
      <AnimatePresence>
        {shareChannel && parsedData && (
          <NFCeShare
            data={parsedData}
            channel={shareChannel}
            onClose={() => setShareChannel(null)}
          />
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="border-t border-white/5 bg-[#121215] py-6 text-center text-[10px] text-slate-500 font-medium print:hidden mt-12">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p>© 2026 Leitor e Emissor de NFC-e. Todos os direitos reservados.</p>
          <p className="flex items-center justify-center gap-1">
            <span className="text-slate-600">Desenvolvido com IA Avançada para Automação Fiscal Comercial</span>
          </p>
        </div>
      </footer>
    </div>
  );
}

import { useState, useEffect, useRef, ChangeEvent, FormEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Camera, Upload, FileText, Globe, Search, Loader2, AlertCircle, ImageUp } from "lucide-react";
import { Html5QrcodeScanner, Html5Qrcode } from "html5-qrcode";
import { NFCeData } from "../types";

interface NFCeScannerProps {
  onDataParsed: (data: NFCeData, sourceType: string) => void;
}

type ScanTab = "camera" | "upload-image" | "html-paste" | "manual-url";

export default function NFCeScanner({ onDataParsed }: NFCeScannerProps) {
  const [activeTab, setActiveTab] = useState<ScanTab>("camera");
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState("");
  const [ocrPreview, setOcrPreview] = useState<string | null>(null);

  // HTML/Text Paste States
  const [pastedContent, setPastedContent] = useState("");

  // Refs for elements
  const qrCodeScannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ocrFileInputRef = useRef<HTMLInputElement>(null);

  // Initialize camera scanner when "camera" tab is active and camera starts
  useEffect(() => {
    if (activeTab !== "camera" || !scanning) {
      stopCameraScanner();
      return;
    }

    const startCamera = async () => {
      try {
        setError(null);
        // Clean up any existing instances first
        if (qrCodeScannerRef.current) {
          await qrCodeScannerRef.current.stop().catch(() => {});
          qrCodeScannerRef.current = null;
        }

        const scanner = new Html5Qrcode("camera-viewfinder");
        qrCodeScannerRef.current = scanner;

        const config = {
          fps: 10,
          qrbox: (width: number, height: number) => {
            const size = Math.min(width, height) * 0.7;
            return { width: size, height: size };
          },
          aspectRatio: 1.0,
        };

        await scanner.start(
          { facingMode: "environment" },
          config,
          (decodedText) => {
            // Success scanning QR Code
            handleQrCodeDetected(decodedText);
          },
          () => {
            // Error scanning, silent
          }
        );
      } catch (err: any) {
        console.error("Camera start error:", err);
        setError("Não foi possível acessar a câmera. Certifique-se de conceder permissão ou tente fazer o upload de uma foto da nota.");
        setScanning(false);
      }
    };

    // Small delay to allow element rendering
    const timer = setTimeout(() => {
      startCamera();
    }, 150);

    return () => {
      clearTimeout(timer);
      stopCameraScanner();
    };
  }, [activeTab, scanning]);

  const stopCameraScanner = async () => {
    if (qrCodeScannerRef.current && qrCodeScannerRef.current.isScanning) {
      try {
        await qrCodeScannerRef.current.stop();
      } catch (e) {
        console.warn("Error stopping camera scanner:", e);
      }
      qrCodeScannerRef.current = null;
    }
  };

  // When a QR Code URL is detected
  const handleQrCodeDetected = async (url: string) => {
    stopCameraScanner();
    setScanning(false);
    await processNFCeSource({ url });
  };

  // Helper to send data to our Express backend
  const processNFCeSource = async (payload: { url?: string; html?: string; text?: string }) => {
    setLoading(true);
    setError(null);

    if (payload.url) {
      setLoadingMessage("Acessando o portal do SEFAZ e extraindo cupom fiscal...");
    } else {
      setLoadingMessage("Processando dados e interpretando itens fiscais...");
    }

    try {
      const response = await fetch("/api/parse-nfce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Safely parse response — server might return HTML on crash/proxy error
      const rawText = await response.text();
      let resData: any;
      try {
        resData = JSON.parse(rawText);
      } catch {
        console.error("Resposta não-JSON do servidor:", rawText.slice(0, 200));
        throw new Error(
          "O servidor não está respondendo corretamente. Verifique se ele está ativo e se a GEMINI_API_KEY está configurada nos Segredos do ambiente."
        );
      }

      if (!response.ok) {
        throw new Error(resData.error || "Ocorreu uma falha ao decodificar a NFC-e.");
      }

      if (resData.data) {
        onDataParsed(resData.data, resData.sourceType || "Desconhecido");
      } else {
        throw new Error("Nenhum dado fiscal foi extraído da fonte fornecida.");
      }
    } catch (err: any) {
      console.error("Parse error:", err);
      setError(err.message || "Erro de conexão com o servidor. Verifique se o servidor está ativo.");
    } finally {
      setLoading(false);
      setLoadingMessage("");
    }
  };

  // File picker handler for QR code image decoding
  const handleQrFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setLoadingMessage("Decodificando QR Code da imagem...");

    try {
      const html5Qr = new Html5Qrcode("qr-file-decoder");
      const decodedText = await html5Qr.scanFile(file, true);
      await processNFCeSource({ url: decodedText });
    } catch (err: any) {
      console.error("QR file decode error:", err);
      setError("Não encontramos nenhum QR Code legível nesta imagem. Tente uma foto mais nítida ou use a aba 'Foto da Nota' para OCR completo.");
    } finally {
      setLoading(false);
    }
  };

  // OCR handler: uses Tesseract.js to extract text from uploaded NFC-e screenshot
  const handleOcrImageSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setOcrProgress(0);
    setLoadingMessage("Carregando motor de leitura (primeira vez pode levar ~20s)...");

    // Show image preview
    const previewUrl = URL.createObjectURL(file);
    setOcrPreview(previewUrl);

    try {
      // Dynamic import — keeps the main bundle light
      const Tesseract = (await import("tesseract.js")).default;

      setLoadingMessage("Lendo texto da imagem (OCR em português)...");

      const { data: { text } } = await Tesseract.recognize(file, "por", {
        logger: (m: any) => {
          if (m.status === "recognizing text") {
            setOcrProgress(Math.round(m.progress * 100));
            setLoadingMessage(`Extraindo texto da imagem... ${Math.round(m.progress * 100)}%`);
          }
        },
      });

      if (!text || text.trim().length < 50) {
        throw new Error("Não foi possível extrair texto legível desta imagem. Verifique se a imagem está nítida e contém texto da NFC-e.");
      }

      setLoadingMessage("Identificando dados fiscais no texto extraído...");
      await processNFCeSource({ text: text.trim() });
    } catch (err: any) {
      console.error("OCR error:", err);
      setError(err.message || "Falha ao processar a imagem. Tente com uma imagem mais nítida.");
    } finally {
      setLoading(false);
      setLoadingMessage("");
      setOcrProgress(0);
      // Reset file input so same file can be re-selected
      if (ocrFileInputRef.current) ocrFileInputRef.current.value = "";
    }
  };

  const handleManualSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanInput = manualInput.trim();
    if (!cleanInput) return;

    if (cleanInput.startsWith("http://") || cleanInput.startsWith("https://")) {
      await processNFCeSource({ url: cleanInput });
    } else if (/^\d{44}$/.test(cleanInput.replace(/\s+/g, ""))) {
      // Reconstruct standard check URL
      const key = cleanInput.replace(/\s+/g, "");
      await processNFCeSource({ url: `https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?chaveDeAcesso=${key}` });
    } else {
      setError("Por favor, insira um link de NFC-e válido (começando com http) ou a chave de acesso de 44 dígitos.");
    }
  };

  const handlePasteSubmit = async () => {
    const content = pastedContent.trim();
    if (!content) return;

    // Detect if content looks like HTML
    if (content.includes("<html") || content.includes("<table") || content.includes("<div")) {
      await processNFCeSource({ html: content });
    } else {
      await processNFCeSource({ text: content });
    }
  };

  return (
    <div id="nfc-e-scanner-container" className="w-full max-w-2xl mx-auto bg-[#0F0F12] border border-white/5 rounded-3xl shadow-2xl overflow-hidden">
      {/* Hidden container for html5-qrcode image decoding */}
      <div id="qr-file-decoder" className="hidden"></div>

      {/* Tabs */}
      <div className="flex border-b border-white/5 bg-[#0D0D0F] p-2 gap-1" id="scanner-tabs">
        {(
          [
            { id: "camera", label: "Câmera", icon: Camera },
            { id: "upload-image", label: "Print da Nota", icon: ImageUp },
            { id: "html-paste", label: "Colar Dados", icon: FileText },
            { id: "manual-url", label: "Digitar URL", icon: Globe },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`tab-btn-${tab.id}`}
              onClick={() => {
                setActiveTab(tab.id);
                setError(null);
                setScanning(false);
                setOcrPreview(null);
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 px-1 rounded-xl text-[11px] sm:text-xs font-medium transition-all cursor-pointer ${
                isActive
                  ? "bg-[#121215] text-white shadow-md border border-white/10 font-semibold"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="leading-tight text-center">{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="p-6">
        {/* Loading Overlay */}
        <AnimatePresence>
          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              id="loading-overlay"
              className="absolute inset-0 bg-black/95 backdrop-blur-xs z-50 flex flex-col items-center justify-center p-8 text-center animate-fade-in"
            >
              <Loader2 className="w-12 h-12 text-emerald-500 animate-spin mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">Processando NFC-e</h3>
              <p className="text-sm text-slate-400 max-w-sm leading-relaxed">{loadingMessage}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tab Contents */}
        <div className="min-h-[300px] flex flex-col justify-between" id="tab-content-area">
          <AnimatePresence mode="wait">
            {activeTab === "camera" && (
              <motion.div
                key="camera-tab"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex flex-col items-center justify-center flex-1 py-4"
              >
                {!scanning ? (
                  <div className="text-center max-w-sm flex flex-col items-center py-6">
                    <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-4 text-emerald-400 shadow-inner">
                      <Camera className="w-8 h-8" />
                    </div>
                    <h3 className="text-base font-semibold text-white mb-1">Escanear com a Câmera</h3>
                    <p className="text-xs text-slate-400 mb-6">
                      Aponte a câmera para o QR Code quadrado no final da NFC-e impressa para extrair e gerar o PDF instantaneamente.
                    </p>
                    <button
                      id="btn-start-camera"
                      onClick={() => setScanning(true)}
                      className="w-full sm:w-auto bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-6 py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-md cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      Começar Leitura
                    </button>

                    <div className="relative flex items-center justify-center w-full my-6">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-white/5"></div>
                      </div>
                      <span className="relative px-3 bg-[#0F0F12] text-[11px] font-medium text-slate-500 uppercase tracking-wider">ou</span>
                    </div>

                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleQrFileSelected}
                      accept="image/*"
                      className="hidden"
                      id="qr-file-input"
                    />
                    <button
                      id="btn-upload-qr-file"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full sm:w-auto bg-[#121215] hover:bg-[#18181c] text-slate-300 border border-white/5 font-medium px-5 py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer text-xs"
                    >
                      <Upload className="w-3.5 h-3.5 text-slate-400" />
                      Enviar imagem do QR Code
                    </button>
                  </div>
                ) : (
                  <div className="w-full flex flex-col items-center">
                    <div className="relative w-full max-w-xs aspect-square bg-black rounded-2xl overflow-hidden shadow-2xl border-4 border-[#121215]">
                      <div id="camera-viewfinder" className="w-full h-full object-cover"></div>
                      
                      {/* Viewfinder Target Graphic */}
                      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                        <div className="w-48 h-48 border-2 border-emerald-500/50 rounded-2xl relative">
                          <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-emerald-500 rounded-tl-md"></div>
                          <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-emerald-500 rounded-tr-md"></div>
                          <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-emerald-500 rounded-bl-md"></div>
                          <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-emerald-500 rounded-br-md"></div>
                          
                          {/* Laser Scan beam */}
                          <div className="w-full h-[2px] bg-emerald-500 absolute top-1/2 shadow-[0_0_15px_rgba(16,185,129,0.8)] animate-bounce"></div>
                        </div>
                      </div>
                      <div className="absolute top-3 left-3 bg-red-500/90 text-white text-[10px] px-2.5 py-1 rounded-full font-bold flex items-center gap-1 animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-white"></span>
                        CÂMERA ATIVA
                      </div>
                    </div>

                    <button
                      id="btn-cancel-scanning"
                      onClick={() => setScanning(false)}
                      className="mt-6 text-xs text-red-400 hover:text-red-300 font-semibold cursor-pointer flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 px-4 py-2 rounded-xl border border-red-500/20 transition-all"
                    >
                      Cancelar Escaneamento
                    </button>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === "upload-image" && (
              <motion.div
                key="upload-image-tab"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex flex-col items-center justify-center flex-1 py-4 text-center max-w-md mx-auto gap-4"
              >
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-inner">
                  <ImageUp className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white mb-1">Print / Captura de Tela da Nota</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Acesse o portal SEFAZ no navegador, tire um print (captura de tela) da página da NFC-e e faça o upload aqui. O app lê o texto da imagem e espelha a nota automaticamente.
                  </p>
                </div>

                {ocrPreview && !loading && (
                  <img
                    src={ocrPreview}
                    alt="Preview"
                    className="w-full max-h-40 object-contain rounded-xl border border-white/10 bg-[#121215]"
                  />
                )}

                {loading && ocrProgress > 0 && (
                  <div className="w-full">
                    <div className="flex justify-between text-[11px] text-slate-400 mb-1.5">
                      <span>Extraindo texto da imagem...</span>
                      <span>{ocrProgress}%</span>
                    </div>
                    <div className="w-full bg-white/5 rounded-full h-2">
                      <div
                        className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${ocrProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                <input
                  type="file"
                  ref={ocrFileInputRef}
                  onChange={handleOcrImageSelected}
                  accept="image/*"
                  className="hidden"
                  id="ocr-image-input"
                />
                <button
                  id="btn-upload-ocr-image"
                  onClick={() => { setOcrPreview(null); ocrFileInputRef.current?.click(); }}
                  disabled={loading}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/5 disabled:text-slate-600 text-black font-semibold px-6 py-3 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-md cursor-pointer text-sm"
                >
                  <ImageUp className="w-4 h-4" />
                  {loading ? "Processando imagem..." : "Selecionar Print da Nota"}
                </button>
                <p className="text-[11px] text-slate-500">Suporta JPEG, PNG e WEBP. Funciona sem API key.</p>
              </motion.div>
            )}

            {activeTab === "html-paste" && (
              <motion.div
                key="html-paste-tab"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex flex-col flex-1 py-2"
              >
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-white mb-1">Colar Conteúdo da Nota</h3>
                  <p className="text-xs text-slate-400">
                    Acesse o portal da SEFAZ, selecione e copie todo o conteúdo da página ou o código-fonte HTML, e cole no campo abaixo. A IA estruturará tudo perfeitamente.
                  </p>
                </div>

                <textarea
                  id="textarea-pasted-content"
                  placeholder="Cole o HTML completo ou o texto copiado da página de consulta da SEFAZ aqui..."
                  value={pastedContent}
                  onChange={(e) => setPastedContent(e.target.value)}
                  className="w-full h-44 border border-white/10 rounded-2xl p-4 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-[#121215] text-slate-200 placeholder:text-slate-600 resize-none mb-4"
                />

                <button
                  id="btn-submit-pasted-content"
                  onClick={handlePasteSubmit}
                  disabled={!pastedContent.trim()}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/5 disabled:text-slate-600 text-black font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer text-sm shadow-md"
                >
                  <FileText className="w-4 h-4" />
                  Processar Conteúdo Colado
                </button>
              </motion.div>
            )}

            {activeTab === "manual-url" && (
              <motion.div
                key="manual-url-tab"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex flex-col flex-1 py-2"
              >
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-white mb-1">Digitar Link ou Chave de Acesso</h3>
                  <p className="text-xs text-slate-400">
                    Insira a URL completa obtida ao ler o QR Code ou digite a Chave de Acesso de 44 dígitos impressa no DANFE da sua NFC-e.
                  </p>
                </div>

                <form onSubmit={handleManualSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="input-manual" className="block text-xs font-medium text-slate-400 mb-1.5">
                      Link da NFC-e ou Chave de Acesso (44 números)
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        id="input-manual"
                        placeholder="https://dec.fazenda.df.gov.br/ConsultarNFCe.aspx?p=5322... ou 4321..."
                        value={manualInput}
                        onChange={(e) => setManualInput(e.target.value)}
                        className="w-full border border-white/10 rounded-xl pl-10 pr-4 py-3 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-[#121215] text-slate-200 placeholder:text-slate-600 font-mono"
                      />
                      <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                    </div>
                  </div>

                  <button
                    type="submit"
                    id="btn-submit-manual-input"
                    disabled={!manualInput.trim()}
                    className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/5 disabled:text-slate-600 text-black font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer text-sm shadow-md"
                  >
                    <Search className="w-4 h-4" />
                    Buscar e Analisar Nota
                  </button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error Message */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
                id="error-banner"
                className="mt-6 flex items-start gap-2.5 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-left"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold block mb-0.5">Falha no Processamento</span>
                  <span>{error}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

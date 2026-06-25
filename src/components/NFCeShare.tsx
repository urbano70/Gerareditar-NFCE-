import { useState, FormEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Send, MessageSquare, Mail, CheckCircle2, AlertCircle, Copy, Check, ExternalLink } from "lucide-react";
import { NFCeData } from "../types";

interface NFCeShareProps {
  data: NFCeData;
  channel: "email" | "whatsapp";
  onClose: () => void;
}

export default function NFCeShare({ data, channel, onClose }: NFCeShareProps) {
  // Common states
  const [copied, setCopied] = useState(false);
  const [success, setSuccess] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // WhatsApp States
  const [phone, setPhone] = useState("");
  
  // Email States
  const [email, setEmail] = useState("");
  const [deliveryId, setDeliveryId] = useState("");

  // Helper to compile text summary of NFC-e
  const compileTextSummary = () => {
    const header = `📄 *CUPOM FISCAL ELETRÔNICO (NFC-e)*\n`;
    const storeInfo = `🛒 *Estabelecimento:* ${data.issuer.name}\n📍 *Endereço:* ${data.issuer.address}\n`;
    const docInfo = `🧾 *Nota Nº:* ${data.invoice.number} (Série ${data.invoice.series})\n📅 *Emissão:* ${
      data.invoice.emissionDate.includes("T") 
        ? new Date(data.invoice.emissionDate.substring(0, 19)).toLocaleString("pt-BR")
        : data.invoice.emissionDate
    }\n`;
    
    let itemsList = `\n📦 *Itens Comprados:*\n`;
    data.items.forEach((item, index) => {
      itemsList += `${index + 1}. ${item.description} (x${item.qty} ${item.unit}) - R$ ${item.totalPrice.toFixed(2)}\n`;
    });

    const totalInfo = `\n💰 *VALOR TOTAL: R$ ${data.totals.total.toFixed(2)}*\n💳 *Forma de Pgto:* ${data.totals.paymentType || "Cartão/Dinheiro"}\n`;
    const accessKey = `\n🔑 *Chave de Acesso:*\n\`${data.invoice.accessKey}\`\n`;
    const checkOnline = data.qrCodeUrl ? `\n🌐 *Consulte online:* ${data.qrCodeUrl}` : "";

    return `${header}${storeInfo}${docInfo}${itemsList}${totalInfo}${accessKey}${checkOnline}`;
  };

  // WhatsApp Send Trigger
  const handleWhatsAppSend = () => {
    try {
      const text = compileTextSummary();
      const encodedText = encodeURIComponent(text);
      
      // Remove symbols from phone
      const cleanPhone = phone.replace(/\D/g, "");
      
      // WhatsApp Send URL
      // If phone is provided, send to that specific number (requires country code, default to 55 for Brazil if not specified)
      let wsUrl = `https://api.whatsapp.com/send?text=${encodedText}`;
      if (cleanPhone) {
        const fullPhone = cleanPhone.length === 11 || cleanPhone.length === 10 ? `55${cleanPhone}` : cleanPhone;
        wsUrl = `https://api.whatsapp.com/send?phone=${fullPhone}&text=${encodedText}`;
      }

      window.open(wsUrl, "_blank");
      setSuccess(true);
    } catch (err) {
      setError("Falha ao gerar o link do WhatsApp.");
    }
  };

  // Email Send Trigger
  const handleEmailSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setSending(true);
    setError(null);

    try {
      const response = await fetch("/api/send-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          invoiceData: data,
        }),
      });

      const resData = await response.json();

      if (!response.ok) {
        throw new Error(resData.error || "Ocorreu um erro ao enviar o e-mail.");
      }

      setDeliveryId(resData.deliveryId || "EML-SUCCESS");
      setSuccess(true);
    } catch (err: any) {
      console.error("Email send error:", err);
      setError(err.message || "Erro de conexão ao enviar o e-mail.");
    } finally {
      setSending(false);
    }
  };

  // Copy textual summary to clipboard
  const handleCopyText = () => {
    const text = compileTextSummary();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Direct mailto client trigger as a robust fallback
  const getMailtoLink = () => {
    const subject = encodeURIComponent(`NFC-e Emitida - ${data.issuer.name}`);
    const body = encodeURIComponent(compileTextSummary().replace(/\*/g, "")); // strip asterisks for plain text email
    return `mailto:${email}?subject=${subject}&body=${body}`;
  };

  return (
    <div id="share-modal-backdrop" className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        id="share-modal-container"
        className="bg-[#0F0F12] rounded-3xl shadow-2xl border border-white/5 max-w-md w-full overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/5 bg-[#0D0D0F]">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-xl ${channel === "whatsapp" ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-500/10 text-emerald-400"}`}>
              {channel === "whatsapp" ? <MessageSquare className="w-5 h-5" /> : <Mail className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                {channel === "whatsapp" ? "Enviar via WhatsApp" : "Enviar por E-mail"}
              </h3>
              <p className="text-[11px] text-slate-400">NFC-e Nº {data.invoice.number}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            id="btn-close-share-modal"
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-white/5 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Area */}
        <div className="p-6">
          <AnimatePresence mode="wait">
            {!success ? (
              <motion.div
                key="share-form"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-5"
              >
                {/* Form fields depending on channel */}
                {channel === "whatsapp" ? (
                  <div className="space-y-4">
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Digite o número com o DDD para direcionar diretamente (opcional). Se deixado em branco, abrirá o painel de contatos do WhatsApp para você escolher para quem enviar.
                    </p>
                    
                    <div>
                      <label htmlFor="input-whatsapp-phone" className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wider">
                        Telefone do Cliente
                      </label>
                      <input
                        type="text"
                        id="input-whatsapp-phone"
                        placeholder="Ex: (11) 99999-9999"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-[#121215] text-slate-200 font-mono placeholder:text-slate-600"
                      />
                    </div>

                    <button
                      id="btn-trigger-whatsapp-send"
                      onClick={handleWhatsAppSend}
                      className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-md cursor-pointer text-sm"
                    >
                      <MessageSquare className="w-4 h-4" />
                      Prosseguir para o WhatsApp
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleEmailSend} className="space-y-4">
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Digite o e-mail do destinatário. O resumo da nota será processado e você receberá um ID de controle. Use o link de atalho abaixo para abrir diretamente no seu cliente de e-mail (Outlook, Gmail etc.).
                    </p>

                    <div>
                      <label htmlFor="input-email-recipient" className="block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wider">
                        E-mail de Destino
                      </label>
                      <input
                        type="email"
                        id="input-email-recipient"
                        required
                        placeholder="cliente@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-[#121215] text-slate-200 placeholder:text-slate-600"
                      />
                    </div>

                    {email && (
                      <a
                        href={getMailtoLink()}
                        id="link-mailto-direct"
                        className="flex items-center justify-center gap-1.5 w-full py-2 px-4 bg-[#121215] hover:bg-[#18181c] text-emerald-400 rounded-xl border border-emerald-500/20 text-xs font-semibold transition-all"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Abrir no cliente de e-mail local (Outlook / Gmail)
                      </a>
                    )}

                    <button
                      type="submit"
                      id="btn-trigger-email-send"
                      disabled={sending || !email}
                      className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/5 disabled:text-slate-600 text-black font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-md cursor-pointer text-sm"
                    >
                      {sending ? (
                        <>
                          <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
                          Processando...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          Registrar Envio
                        </>
                      )}
                    </button>
                  </form>
                )}

                <div className="relative flex items-center justify-center w-full my-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/5"></div>
                  </div>
                  <span className="relative px-3 bg-[#0F0F12] text-[10px] font-bold text-slate-500 uppercase tracking-wider">Alternativa</span>
                </div>

                {/* Auxiliary manual copy content */}
                <div className="space-y-3">
                  <p className="text-[10px] text-slate-500 text-center">
                    Você também pode copiar o resumo formatado em texto para colar em qualquer outra rede social.
                  </p>
                  
                  <button
                    id="btn-copy-formatted-summary"
                    onClick={handleCopyText}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-[#121215] hover:bg-[#18181c] text-slate-300 rounded-xl border border-white/5 text-xs font-semibold cursor-pointer transition-all"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-400" />
                        Texto Copiado!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 text-slate-500" />
                        Copiar Resumo em Texto
                      </>
                    )}
                  </button>
                </div>

                {error && (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                      <span>{error}</span>
                    </div>
                    {email && (
                      <a
                        href={getMailtoLink()}
                        id="link-mailto-error-fallback"
                        className="flex items-center justify-center gap-1.5 w-full py-2 px-4 bg-[#121215] hover:bg-[#18181c] text-emerald-400 rounded-xl border border-emerald-500/20 text-xs font-semibold transition-all"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Abrir no cliente de e-mail local como alternativa
                      </a>
                    )}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="share-success"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-center py-6 space-y-4"
              >
                <div className="flex justify-center">
                  <CheckCircle2 className="w-16 h-16 text-emerald-400" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-white">
                    {channel === "whatsapp" ? "Sucesso!" : "Envio Registrado!"}
                  </h4>
                  <p className="text-xs text-slate-400 max-w-xs mx-auto mt-1 leading-normal">
                    {channel === "whatsapp"
                      ? "O link de compartilhamento foi gerado e aberto com sucesso em uma nova aba."
                      : "Envio registrado com ID de controle. Use o link abaixo para abrir no seu cliente de e-mail e confirmar a entrega."}
                  </p>
                </div>

                {channel === "email" && deliveryId && (
                  <div className="bg-[#121215] border border-white/5 p-2.5 rounded-xl text-[10px] font-mono text-slate-400 inline-block">
                    ID DE ENTREGA: {deliveryId}
                  </div>
                )}

                {channel === "email" && (
                  <div className="pt-2">
                    <a
                      href={getMailtoLink()}
                      id="link-mailto-fallback"
                      className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 font-bold hover:underline"
                    >
                      Abrir no meu aplicativo de e-mail local (Outlook/Gmail)
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}

                <button
                  id="btn-close-share-success"
                  onClick={onClose}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-semibold py-2.5 rounded-xl transition-colors text-xs cursor-pointer"
                >
                  Fechar Janela
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

import React, { useState, useRef, useEffect } from "react";
import { motion } from "motion/react";
import {
  Download, Printer, Edit2, Check, X, FileText, ChevronLeft, Plus, Trash2,
  Mail, MessageSquare, Sliders, UploadCloud,
} from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import QRCode from "qrcode";
import { NFCeData, NFCeItem } from "../types";

interface NFCeViewerProps {
  data: NFCeData;
  onUpdateData: (updatedData: NFCeData) => void;
  onBack: () => void;
  onOpenShare: (channel: "email" | "whatsapp") => void;
}

const COLOR_PRESETS = [
  { name: "Clássico", title: "#0f172a", text: "#475569", border: "#cbd5e1", value: "#000000", accent: "#10b981" },
  { name: "Esmeralda", title: "#064e3b", text: "#0f766e", border: "#a7f3d0", value: "#047857", accent: "#10b981" },
  { name: "Azul", title: "#1e3a8a", text: "#1d4ed8", border: "#bfdbfe", value: "#1e40af", accent: "#3b82f6" },
  { name: "Vinho", title: "#581c87", text: "#701a75", border: "#f5d0fe", value: "#86198f", accent: "#d946ef" },
  { name: "Carvão", title: "#1e293b", text: "#334155", border: "#cbd5e1", value: "#0f172a", accent: "#64748b" },
];

const brMoney = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatInvoiceNumber = (num: string) => {
  const clean = (num || "").replace(/\D/g, "").padStart(9, "0");
  return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}`;
};

const formatEmissionDate = (dateStr: string) => {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr.includes("T") ? dateStr.substring(0, 19) : dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const opts: Intl.DateTimeFormatOptions = {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    };
    return d.toLocaleString("pt-BR", opts).replace(",", "");
  } catch { return dateStr; }
};

const getSefazPortalUrl = (qrUrl?: string): string => {
  if (!qrUrl) return "www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx";
  try {
    const url = new URL(qrUrl);
    return url.hostname + url.pathname.split("?")[0];
  } catch {
    return qrUrl.split("?")[0].replace(/^https?:\/\//, "");
  }
};

const NFCeLogoImg = () => (
  <img src="/nfce-logo.png" alt="NFC-e" style={{ height: 48, width: "auto" }} />
);

export default function NFCeViewer({ data, onUpdateData, onBack, onOpenShare }: NFCeViewerProps) {
  const [layout, setLayout] = useState<"thermal" | "a4">("thermal");
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState<NFCeData>({ ...data });
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [companyLogo, setCompanyLogo] = useState<string | null>(null);
  const [titleColor, setTitleColor] = useState("#0f172a");
  const [textColor, setTextColor] = useState("#475569");
  const [borderColor, setBorderColor] = useState("#cbd5e1");
  const [valueColor, setValueColor] = useState("#000000");
  const [accentColor, setAccentColor] = useState("#10b981");
  const [dragActive, setDragActive] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);

  const receiptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = data.qrCodeUrl || data.invoice.accessKey;
    if (!target) { setQrCodeDataUrl(null); return; }
    QRCode.toDataURL(target, { width: 120, margin: 1, color: { dark: "#000000", light: "#ffffff" } })
      .then(setQrCodeDataUrl)
      .catch(() => setQrCodeDataUrl(null));
  }, [data.qrCodeUrl, data.invoice.accessKey]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) {
      const reader = new FileReader();
      reader.onloadend = () => setCompanyLogo(reader.result as string);
      reader.readAsDataURL(e.dataTransfer.files[0]);
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setCompanyLogo(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const recalculateTotals = (items: NFCeItem[], discount: number, paymentType: string) => {
    const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
    const total = Math.max(0, subtotal - discount);
    return { subtotal, discount, total, icms: parseFloat((total * 0.12).toFixed(2)), paymentType };
  };

  const handleIssuerChange = (field: string, value: string) => {
    setEditedData({ ...editedData, issuer: { ...editedData.issuer, [field]: value } });
  };

  const handleInvoiceChange = (field: string, value: string) => {
    setEditedData({ ...editedData, invoice: { ...editedData.invoice, [field]: value } });
  };

  const handleConsumerChange = (value: string) => {
    setEditedData({ ...editedData, consumer: { ...editedData.consumer, cpf: value } });
  };

  const handleItemChange = (index: number, field: keyof NFCeItem, value: any) => {
    const updatedItems = [...editedData.items];
    const item = { ...updatedItems[index] };
    if (field === "qty") {
      item.qty = Math.max(0.001, parseFloat(value) || 0);
      item.totalPrice = parseFloat((item.qty * item.unitPrice).toFixed(2));
    } else if (field === "unitPrice") {
      item.unitPrice = Math.max(0, parseFloat(value) || 0);
      item.totalPrice = parseFloat((item.qty * item.unitPrice).toFixed(2));
    } else if (field === "totalPrice") {
      item.totalPrice = Math.max(0, parseFloat(value) || 0);
    } else {
      (item as any)[field] = value;
    }
    updatedItems[index] = item;
    setEditedData({ ...editedData, items: updatedItems, totals: recalculateTotals(updatedItems, editedData.totals.discount, editedData.totals.paymentType) });
  };

  const handleAddItem = () => {
    const newItem: NFCeItem = {
      code: Math.floor(1000 + Math.random() * 9000).toString(),
      description: "NOVO ITEM FISCAL",
      qty: 1, unit: "UN", unitPrice: 0, totalPrice: 0,
    };
    const updatedItems = [...editedData.items, newItem];
    setEditedData({ ...editedData, items: updatedItems, totals: recalculateTotals(updatedItems, editedData.totals.discount, editedData.totals.paymentType) });
  };

  const handleDeleteItem = (index: number) => {
    const updatedItems = editedData.items.filter((_, i) => i !== index);
    setEditedData({ ...editedData, items: updatedItems, totals: recalculateTotals(updatedItems, editedData.totals.discount, editedData.totals.paymentType) });
  };

  const handleSaveEdits = () => { onUpdateData(editedData); setIsEditing(false); };
  const handleCancelEdits = () => { setEditedData({ ...data }); setIsEditing(false); };

  const handleDownloadPdf = async () => {
    const element = receiptRef.current;
    if (!element) return;
    setGeneratingPdf(true);
    try {
      const canvas = await html2canvas(element, { scale: 2, useCORS: true, logging: false, backgroundColor: "#ffffff" });
      const imgData = canvas.toDataURL("image/png");
      const pdfWidth = layout === "thermal" ? 80 : 210;
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: layout === "thermal" ? [80, Math.max(100, pdfHeight)] : "a4" });
      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      pdf.save(`NFCe_${data.invoice.number || "nota"}.pdf`);
    } catch (err) {
      console.error("Falha ao gerar PDF:", err);
      alert("Houve um erro ao gerar o arquivo PDF.");
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handlePrint = () => window.print();

  const formatAccessKey = (key: string) => {
    const clean = (key || "").replace(/\s+/g, "");
    const chunks: string[] = [];
    for (let i = 0; i < clean.length; i += 4) chunks.push(clean.substring(i, i + 4));
    return chunks.join(" ");
  };

  const displayData = isEditing ? editedData : data;

  return (
    <div className="w-full max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start px-2 sm:px-4 mb-16 animate-fade-in" id="viewer-container">

      {/* ===== PAINEL DE CONTROLE ===== */}
      <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-6" id="control-panel">
        <button onClick={onBack} id="btn-back-to-scan"
          className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 font-medium transition-all group bg-[#0F0F12] hover:bg-[#121215] py-2.5 px-4 rounded-xl border border-white/5 cursor-pointer">
          <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5 text-emerald-400" />
          Voltar para Leitura
        </button>

        <div className="bg-[#0F0F12] border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
          <div>
            <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-400" />
              Documento Carregado
            </h2>
            <p className="text-xs text-slate-400">NFC-e carregada e convertida em DANFE para edição e compartilhamento.</p>
          </div>

          <div className="space-y-2.5" id="action-buttons-group">
            <button id="btn-download-pdf-viewer" disabled={generatingPdf || isEditing} onClick={handleDownloadPdf}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/5 disabled:text-slate-600 text-black font-semibold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2 shadow-md cursor-pointer text-sm">
              {generatingPdf
                ? <><div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />Gerando PDF...</>
                : <><Download className="w-4 h-4" />Baixar Cupom em PDF</>
              }
            </button>

            <button id="btn-print-viewer" disabled={isEditing} onClick={handlePrint}
              className="w-full bg-[#121215] hover:bg-[#18181c] text-slate-300 font-medium py-2.5 px-4 rounded-xl border border-white/5 transition-all flex items-center justify-center gap-2 cursor-pointer text-xs shadow-sm">
              <Printer className="w-4 h-4 text-emerald-400" />Imprimir Nota
            </button>

            {!isEditing ? (
              <button id="btn-edit-mode" onClick={() => { setEditedData({ ...data }); setIsEditing(true); }}
                className="w-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-semibold py-2.5 px-4 rounded-xl border border-emerald-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer text-xs">
                <Edit2 className="w-3.5 h-3.5" />Editar Dados da Nota
              </button>
            ) : (
              <div className="flex gap-2" id="edit-mode-actions">
                <button id="btn-save-edits" onClick={handleSaveEdits}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold py-2.5 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer text-xs shadow-md">
                  <Check className="w-4 h-4" />Salvar
                </button>
                <button id="btn-cancel-edits" onClick={handleCancelEdits}
                  className="flex-1 bg-[#121215] hover:bg-[#18181c] text-slate-300 font-medium py-2.5 px-3 rounded-xl border border-white/5 transition-all flex items-center justify-center gap-1.5 cursor-pointer text-xs">
                  <X className="w-4 h-4 text-red-400" />Cancelar
                </button>
              </div>
            )}
          </div>

          <hr className="border-white/5" />

          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Enviar para Cliente</h3>
            <div className="grid grid-cols-2 gap-2" id="share-buttons-grid">
              <button id="btn-share-whatsapp" onClick={() => onOpenShare("whatsapp")}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 font-semibold transition-all cursor-pointer text-xs">
                <MessageSquare className="w-4 h-4" />WhatsApp
              </button>
              <button id="btn-share-email" onClick={() => onOpenShare("email")}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-slate-300 bg-[#121215] hover:bg-[#18181c] border border-white/5 font-medium transition-all cursor-pointer text-xs">
                <Mail className="w-4 h-4 text-emerald-400" />E-mail
              </button>
            </div>
          </div>

          <hr className="border-white/5" />

          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Layout do PDF</h3>
            <div className="flex bg-[#0D0D0F] p-1 rounded-xl border border-white/5">
              <button id="btn-layout-thermal" onClick={() => setLayout("thermal")}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${layout === "thermal" ? "bg-[#121215] text-white shadow-sm border border-white/10" : "text-slate-400 hover:text-slate-200"}`}>
                Bobina (80mm)
              </button>
              <button id="btn-layout-a4" onClick={() => setLayout("a4")}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${layout === "a4" ? "bg-[#121215] text-white shadow-sm border border-white/10" : "text-slate-400 hover:text-slate-200"}`}>
                A4
              </button>
            </div>
          </div>
        </div>

        {/* Card de Personalização */}
        <div className="bg-[#0F0F12] border border-white/5 rounded-3xl p-6 shadow-2xl space-y-5" id="brand-customization-card">
          <div>
            <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-emerald-400" />
              Logotipo da Empresa
            </h3>
            <p className="text-[11px] text-slate-400">Adicione a logo da empresa no cabeçalho do DANFE.</p>
          </div>

          {!companyLogo ? (
            <div
              onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag} onDrop={handleDrop}
              onClick={() => document.getElementById("logo-upload-input")?.click()}
              className={`border-2 border-dashed rounded-2xl p-4 text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-2 ${dragActive ? "border-emerald-400 bg-emerald-500/5" : "border-white/10 bg-[#121215] hover:border-white/20"}`}>
              <UploadCloud className="w-8 h-8 text-slate-500" />
              <div>
                <p className="text-xs font-semibold text-slate-300">Carregar logo</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Arraste ou clique para selecionar</p>
              </div>
              <input id="logo-upload-input" type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
            </div>
          ) : (
            <div className="bg-[#121215] border border-white/10 rounded-2xl p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 overflow-hidden">
                <div className="bg-white p-1 rounded-lg shrink-0 w-10 h-10 flex items-center justify-center">
                  <img src={companyLogo} alt="Logo" className="max-w-full max-h-full object-contain" />
                </div>
                <span className="text-[11px] text-slate-300 truncate font-mono font-bold">logo_carregada</span>
              </div>
              <button onClick={() => setCompanyLogo(null)}
                className="p-1.5 hover:bg-white/5 rounded-lg text-slate-400 hover:text-red-400 transition-colors cursor-pointer">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}

          <hr className="border-white/5" />

          <div className="space-y-3">
            <label className="text-xs font-bold text-slate-400 block uppercase tracking-wider">Paletas de Cores (Barra lateral)</label>
            <div className="grid grid-cols-5 gap-1.5">
              {COLOR_PRESETS.map((preset) => {
                const isSelected = titleColor === preset.title && textColor === preset.text;
                return (
                  <button key={preset.name}
                    onClick={() => { setTitleColor(preset.title); setTextColor(preset.text); setBorderColor(preset.border); setValueColor(preset.value); setAccentColor(preset.accent); }}
                    className={`p-1.5 rounded-xl border flex flex-col items-center gap-1 transition-all cursor-pointer ${isSelected ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400 font-bold" : "border-white/5 bg-[#121215] text-slate-400 hover:text-slate-200 hover:bg-[#18181c]"}`}
                    title={preset.name}>
                    <div className="flex -space-x-1.5 mb-0.5">
                      <span className="w-3.5 h-3.5 rounded-full border border-black/40 shadow-sm" style={{ backgroundColor: preset.title }} />
                      <span className="w-3.5 h-3.5 rounded-full border border-black/40 shadow-sm" style={{ backgroundColor: preset.accent }} />
                      <span className="w-3.5 h-3.5 rounded-full border border-black/40 shadow-sm" style={{ backgroundColor: preset.border }} />
                    </div>
                    <span className="text-[9px] font-medium truncate max-w-full">{preset.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ===== DANFE NFC-e ===== */}
      <div className="lg:col-span-8 flex justify-center animate-fade-in" id="receipt-viewport">
        <div
          ref={receiptRef}
          id="printable-receipt"
          className={`bg-white text-black shadow-2xl border border-slate-200 transition-all duration-300 overflow-hidden ${
            layout === "thermal"
              ? "w-[340px] px-5 py-6 text-[10.5px] leading-snug select-text"
              : "w-full max-w-[640px] px-12 py-10 text-[11.5px] leading-snug select-text"
          }`}
        >
          <style>{`
            #printable-receipt { font-family: 'Courier New', Courier, monospace; }
            @media print {
              body * { visibility: hidden !important; }
              #printable-receipt, #printable-receipt * { visibility: visible !important; }
              #printable-receipt {
                position: absolute !important; left: 0 !important; top: 0 !important;
                width: 100% !important; max-width: 100% !important;
                box-shadow: none !important; border: none !important;
                padding: 16px !important; margin: 0 !important;
              }
            }
          `}</style>

          {/* 1 — CABEÇALHO */}
          {isEditing ? (
            <div className="space-y-2 bg-emerald-50 p-3 rounded-xl border border-emerald-200 mb-3">
              <span className="text-[10px] font-bold text-emerald-600 uppercase block">Dados do Estabelecimento</span>
              <input type="text" placeholder="Razão Social" value={editedData.issuer.name}
                onChange={(e) => handleIssuerChange("name", e.target.value)}
                className="w-full bg-white border border-slate-200 rounded px-2.5 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
              <input type="text" placeholder="CNPJ" value={editedData.issuer.cnpj}
                onChange={(e) => handleIssuerChange("cnpj", e.target.value)}
                className="w-full bg-white border border-slate-200 rounded px-2.5 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
              <input type="text" placeholder="Endereço" value={editedData.issuer.address}
                onChange={(e) => handleIssuerChange("address", e.target.value)}
                className="w-full bg-white border border-slate-200 rounded px-2.5 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
              <div className="grid grid-cols-2 gap-2">
                <input type="text" placeholder="Inscrição Estadual" value={editedData.issuer.ie || ""}
                  onChange={(e) => handleIssuerChange("ie", e.target.value)}
                  className="bg-white border border-slate-200 rounded px-2.5 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
                <input type="text" placeholder="UF" value={editedData.issuer.state}
                  onChange={(e) => handleIssuerChange("state", e.target.value)}
                  className="bg-white border border-slate-200 rounded px-2.5 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 mb-3">
              <div className="shrink-0 mt-0.5">
                <NFCeLogoImg />
              </div>
              <div className="flex-1 text-center">
                {companyLogo && (
                  <img src={companyLogo} alt="Logotipo" className="max-h-10 max-w-[120px] object-contain mx-auto mb-1" referrerPolicy="no-referrer" />
                )}
                <p className="font-bold uppercase text-[11px] leading-tight">{data.issuer.name}</p>
                {data.issuer.address && (
                  <p className="text-[9px] mt-0.5 leading-snug">{data.issuer.address}</p>
                )}
                <p className="text-[9px] mt-0.5">
                  CNPJ: {data.issuer.cnpj}{data.issuer.ie ? ` - IE: ${data.issuer.ie}` : ""}
                </p>
              </div>
            </div>
          )}

          {/* 2 — TÍTULO DANFE */}
          <div className="text-center border-t border-b border-black py-2 mb-2">
            <p className="font-bold text-[10px] uppercase leading-snug">DANFE NFC-e – Documento Auxiliar</p>
            <p className="font-bold text-[10px] uppercase leading-snug">da Nota Fiscal Eletrônica de Consumidor Final</p>
            <p className="text-[10px] mt-1">Não permite aproveitamento de crédito do ICMS</p>
          </div>

          {/* 3 — TABELA DE ITENS */}
          <div className="mb-1">
            <div className="flex text-[9px] font-bold pb-0.5 mb-0.5 uppercase border-b border-black">
              <span className="w-7 shrink-0">Cod</span>
              <span className="flex-1">Descrição</span>
              <span className="w-10 text-right shrink-0">Qtd</span>
              <span className="w-7 text-center shrink-0">Un</span>
              <span className="w-14 text-right shrink-0">Vl.Unit</span>
              <span className="w-14 text-right shrink-0">Vl.Total</span>
            </div>

            {isEditing ? (
              <div className="space-y-2 my-2">
                {editedData.items.map((item, idx) => (
                  <div key={idx} className="bg-slate-50 p-2 rounded-lg border border-slate-200 space-y-1.5 relative" id={`edit-item-${idx}`}>
                    <button id={`btn-delete-item-${idx}`} onClick={() => handleDeleteItem(idx)}
                      className="absolute right-2 top-2 text-red-500 hover:text-red-700 p-1 rounded cursor-pointer">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <div className="grid grid-cols-12 gap-1">
                      <div className="col-span-2">
                        <label className="text-[8px] font-bold text-slate-500 uppercase block">Cód</label>
                        <input type="text" value={item.code}
                          onChange={(e) => handleItemChange(idx, "code", e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded px-1 py-0.5 text-[9px] focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
                      </div>
                      <div className="col-span-10">
                        <label className="text-[8px] font-bold text-slate-500 uppercase block">Descrição</label>
                        <input type="text" value={item.description}
                          onChange={(e) => handleItemChange(idx, "description", e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[9px] focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      <div>
                        <label className="text-[8px] font-bold text-slate-500 uppercase block">Un</label>
                        <input type="text" value={item.unit}
                          onChange={(e) => handleItemChange(idx, "unit", e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[9px] text-center focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-[8px] font-bold text-slate-500 uppercase block">Qtd</label>
                        <input type="number" step="any" value={item.qty}
                          onChange={(e) => handleItemChange(idx, "qty", e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[9px] text-right focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-[8px] font-bold text-slate-500 uppercase block">Vl.Unit</label>
                        <input type="number" step="0.01" value={item.unitPrice}
                          onChange={(e) => handleItemChange(idx, "unitPrice", e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[9px] text-right focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-[8px] font-bold text-slate-500 uppercase block">Vl.Total</label>
                        <input type="number" step="0.01" value={item.totalPrice}
                          onChange={(e) => handleItemChange(idx, "totalPrice", e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[9px] text-right focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
                      </div>
                    </div>
                  </div>
                ))}
                <button id="btn-add-item-row" onClick={handleAddItem}
                  className="w-full bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1">
                  <Plus className="w-3 h-3" />Adicionar Item
                </button>
              </div>
            ) : (
              <div className="border-b border-dashed border-black pb-1 mb-1">
                {data.items.map((item, idx) => (
                  <div key={idx} className="flex py-0.5 border-b border-dotted border-gray-300 last:border-b-0" id={`item-row-${idx}`}>
                    <span className="w-7 shrink-0">{item.code}</span>
                    <span className="flex-1 uppercase font-medium leading-tight pr-1">{item.description}</span>
                    <span className="w-10 text-right shrink-0">{item.qty.toFixed(2).replace(".", ",")}</span>
                    <span className="w-7 text-center shrink-0">{item.unit}</span>
                    <span className="w-14 text-right shrink-0">{item.unitPrice.toFixed(2).replace(".", ",")}</span>
                    <span className="w-14 text-right shrink-0 font-bold">{item.totalPrice.toFixed(2).replace(".", ",")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 4 — TOTAIS */}
          {isEditing ? (
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2 mb-3">
              <span className="text-[10px] font-bold text-slate-500 uppercase block">Totais & Pagamento</span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[8px] font-bold text-slate-500 uppercase block">Desconto (R$)</label>
                  <input type="number" step="0.01" value={editedData.totals.discount}
                    onChange={(e) => { const d = parseFloat(e.target.value) || 0; setEditedData({ ...editedData, totals: recalculateTotals(editedData.items, d, editedData.totals.paymentType) }); }}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs text-right focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-[8px] font-bold text-slate-500 uppercase block">Forma Pagamento</label>
                  <input type="text" value={editedData.totals.paymentType}
                    onChange={(e) => setEditedData({ ...editedData, totals: { ...editedData.totals, paymentType: e.target.value } })}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
                </div>
              </div>
              <div className="flex justify-between items-center bg-white p-2 rounded border border-slate-200">
                <span className="text-xs font-bold text-slate-700">Total Líquido:</span>
                <span className="text-sm font-extrabold text-slate-900">R$ {brMoney(editedData.totals.total)}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-0.5 border-b border-dashed border-black pb-2 mb-2">
              <div className="flex justify-between">
                <span>Qtd. Total de Itens</span>
                <span className="font-medium">{data.items.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Valor Total</span>
                <span className="font-medium">R$ {brMoney(data.totals.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Valor Desconto</span>
                <span className="font-medium">R$ {brMoney(data.totals.discount)}</span>
              </div>
              <div className="flex justify-between">
                <span>Valor Troco</span>
                <span className="font-medium">R$ 0,00</span>
              </div>
              <div className="flex justify-between">
                <span>Valor Despesas</span>
                <span className="font-medium">R$ 0,00</span>
              </div>
            </div>
          )}

          {/* 5 — PAGAMENTO */}
          {!isEditing && (
            <div className="border-b border-dashed border-black pb-2 mb-2">
              <div className="flex justify-between font-bold mb-0.5">
                <span>Forma de Pagamento</span>
                <span>Valor Pago</span>
              </div>
              <div className="flex justify-between">
                <span>{data.totals.paymentType || "Dinheiro"}</span>
                <span>{brMoney(data.totals.total)}</span>
              </div>
            </div>
          )}

          {/* 6 — TRIBUTOS */}
          {!isEditing && data.totals.icms && data.totals.icms > 0 ? (
            <div className="text-center text-[9px] border-b border-dashed border-black pb-2 mb-2 leading-relaxed">
              <p>
                Valor aprox. dos Tributos: R$ {brMoney(data.totals.icms)}{" "}
                ({((data.totals.icms / (data.totals.total || 1)) * 100).toFixed(2)}%) (Fonte: IPBT -
              </p>
              <p>Tributos(Lei Federal 12.741/2012))</p>
            </div>
          ) : null}

          {/* 7 — METADADOS */}
          {isEditing ? (
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2 mb-3">
              <span className="text-[10px] font-bold text-slate-500 uppercase block">Metadados da Nota</span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[8px] font-bold text-slate-500 uppercase block">Número</label>
                  <input type="text" value={editedData.invoice.number}
                    onChange={(e) => handleInvoiceChange("number", e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-[8px] font-bold text-slate-500 uppercase block">Série</label>
                  <input type="text" value={editedData.invoice.series}
                    onChange={(e) => handleInvoiceChange("series", e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="text-[8px] font-bold text-slate-500 uppercase block">Chave de Acesso (44 dígitos)</label>
                <input type="text" value={editedData.invoice.accessKey}
                  onChange={(e) => handleInvoiceChange("accessKey", e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[11px] font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-[8px] font-bold text-slate-500 uppercase block">Data de Emissão</label>
                <input type="text" value={editedData.invoice.emissionDate}
                  onChange={(e) => handleInvoiceChange("emissionDate", e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-[8px] font-bold text-slate-500 uppercase block">Protocolo de Autorização</label>
                <input type="text" value={editedData.invoice.protocol || ""}
                  onChange={(e) => handleInvoiceChange("protocol", e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
              </div>
            </div>
          ) : (
            <div className="text-center text-[10px] border-b border-dashed border-black pb-2 mb-2 space-y-0.5 leading-relaxed">
              <p>Número: {formatInvoiceNumber(data.invoice.number)} - Série: {data.invoice.series}</p>
              <p>Emissão {formatEmissionDate(data.invoice.emissionDate)} -</p>
              <p>Consulte pela chave de acesso em:</p>
              <p className="text-[9px]">{getSefazPortalUrl(data.qrCodeUrl)}</p>
              <p className="font-mono text-[9px] break-all leading-relaxed mt-1">
                {formatAccessKey(data.invoice.accessKey)}
              </p>
            </div>
          )}

          {/* 8 — CONSUMIDOR (modo edição) */}
          {isEditing && (
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2 mb-3">
              <span className="text-[10px] font-bold text-slate-500 uppercase block">Consumidor</span>
              <div>
                <label className="text-[8px] font-bold text-slate-500 uppercase block">CPF do Consumidor (opcional)</label>
                <input
                  type="text"
                  placeholder="000.000.000-00"
                  value={editedData.consumer?.cpf || ""}
                  onChange={(e) => handleConsumerChange(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* 8 — QR CODE + CONSUMIDOR + PROTOCOLO */}
          {!isEditing && (
            <div className="flex gap-3 border-b border-dashed border-black pb-3 mb-3 items-start">
              <div className="shrink-0">
                {qrCodeDataUrl ? (
                  <img src={qrCodeDataUrl} width={100} height={100} alt="QR Code NFC-e" className="border border-gray-100" />
                ) : (
                  <div className="w-[100px] h-[100px] border border-black flex items-center justify-center">
                    <span className="text-[8px] font-mono text-center leading-relaxed">QR CODE<br />NFC-e</span>
                  </div>
                )}
              </div>
              <div className="flex-1 text-[9px] text-center flex flex-col justify-center gap-1.5 pt-1">
                <div>
                  {data.consumer?.cpf ? (
                    <p>Consumidor: {data.consumer.cpf}</p>
                  ) : (
                    <p className="font-bold uppercase">CONSUMIDOR NÃO IDENTIFICADO</p>
                  )}
                </div>
                {data.invoice.protocol && (
                  <div className="mt-1">
                    <p className="font-bold">Protocolo de Autorização</p>
                    <p className="font-mono text-[8px] break-all leading-relaxed">
                      {data.invoice.protocol} {formatEmissionDate(data.invoice.emissionDate)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 9 — RODAPÉ */}
          <div className="text-center text-[9px] pt-1 leading-relaxed">
            <p>
              PROCON {data.issuer.state || "BR"}: www.procon.{(data.issuer.state || "br").toLowerCase()}.gov.br ou 151.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

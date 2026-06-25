import React, { useState, useRef } from "react";
import { motion } from "motion/react";
import { 
  Download, Printer, Edit2, Check, X, FileText, ChevronLeft, Plus, Trash2, 
  Store, Hash, Calendar, DollarSign, Receipt, CreditCard, Mail, MessageSquare,
  Sliders, UploadCloud
} from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { NFCeData, NFCeItem } from "../types";

interface NFCeViewerProps {
  data: NFCeData;
  onUpdateData: (updatedData: NFCeData) => void;
  onBack: () => void;
  onOpenShare: (channel: "email" | "whatsapp") => void;
}

const COLOR_PRESETS = [
  {
    name: "Clássico",
    title: "#0f172a",
    text: "#475569",
    border: "#cbd5e1",
    value: "#000000",
    accent: "#10b981",
  },
  {
    name: "Esmeralda",
    title: "#064e3b",
    text: "#0f766e",
    border: "#a7f3d0",
    value: "#047857",
    accent: "#10b981",
  },
  {
    name: "Azul",
    title: "#1e3a8a",
    text: "#1d4ed8",
    border: "#bfdbfe",
    value: "#1e40af",
    accent: "#3b82f6",
  },
  {
    name: "Vinho",
    title: "#581c87",
    text: "#701a75",
    border: "#f5d0fe",
    value: "#86198f",
    accent: "#d946ef",
  },
  {
    name: "Carvão",
    title: "#1e293b",
    text: "#334155",
    border: "#cbd5e1",
    value: "#0f172a",
    accent: "#64748b",
  }
];

export default function NFCeViewer({ data, onUpdateData, onBack, onOpenShare }: NFCeViewerProps) {
  const [layout, setLayout] = useState<"thermal" | "a4">("thermal");
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState<NFCeData>({ ...data });
  const [generatingPdf, setGeneratingPdf] = useState(false);
  
  const [companyLogo, setCompanyLogo] = useState<string | null>(null);
  const [titleColor, setTitleColor] = useState<string>("#0f172a");
  const [textColor, setTextColor] = useState<string>("#475569");
  const [borderColor, setBorderColor] = useState<string>("#cbd5e1");
  const [valueColor, setValueColor] = useState<string>("#000000");
  const [accentColor, setAccentColor] = useState<string>("#10b981");
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      reader.onloadend = () => {
        setCompanyLogo(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setCompanyLogo(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };
  
  const receiptRef = useRef<HTMLDivElement>(null);

  // Recalculate totals based on items list
  const recalculateTotals = (items: NFCeItem[], currentDiscount: number, currentPaymentType: string) => {
    const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
    const total = Math.max(0, subtotal - currentDiscount);
    return {
      subtotal,
      discount: currentDiscount,
      total,
      icms: parseFloat((total * 0.12).toFixed(2)), // Standard average 12% estimated taxes
      paymentType: currentPaymentType
    };
  };

  // Handle edit changes for Issuer
  const handleIssuerChange = (field: string, value: string) => {
    setEditedData({
      ...editedData,
      issuer: {
        ...editedData.issuer,
        [field]: value
      }
    });
  };

  // Handle edit changes for Invoice Metadata
  const handleInvoiceChange = (field: string, value: string) => {
    setEditedData({
      ...editedData,
      invoice: {
        ...editedData.invoice,
        [field]: value
      }
    });
  };

  // Handle individual item row updates
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
    
    // Recalculate totals automatically
    const totals = recalculateTotals(updatedItems, editedData.totals.discount, editedData.totals.paymentType);

    setEditedData({
      ...editedData,
      items: updatedItems,
      totals
    });
  };

  // Add new blank item
  const handleAddItem = () => {
    const newItem: NFCeItem = {
      code: Math.floor(1000 + Math.random() * 9000).toString(),
      description: "NOVO ITEM FISCAL",
      qty: 1,
      unit: "UN",
      unitPrice: 0.00,
      totalPrice: 0.00
    };
    const updatedItems = [...editedData.items, newItem];
    const totals = recalculateTotals(updatedItems, editedData.totals.discount, editedData.totals.paymentType);
    setEditedData({
      ...editedData,
      items: updatedItems,
      totals
    });
  };

  // Delete item from list
  const handleDeleteItem = (index: number) => {
    const updatedItems = editedData.items.filter((_, i) => i !== index);
    const totals = recalculateTotals(updatedItems, editedData.totals.discount, editedData.totals.paymentType);
    setEditedData({
      ...editedData,
      items: updatedItems,
      totals
    });
  };

  // Save full edits
  const handleSaveEdits = () => {
    onUpdateData(editedData);
    setIsEditing(false);
  };

  // Cancel edits
  const handleCancelEdits = () => {
    setEditedData({ ...data });
    setIsEditing(false);
  };

  // Generate and download PDF
  const handleDownloadPdf = async () => {
    const element = receiptRef.current;
    if (!element) return;

    setGeneratingPdf(true);
    try {
      // Small adjustment: make print background transparent for natural PDF output
      const canvas = await html2canvas(element, {
        scale: 2, // High DPI for professional crisp look
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
      });

      const imgData = canvas.toDataURL("image/png");
      
      // Determine layout PDF dimensions (A4 is 210mm wide, Thermal is 80mm wide)
      const pdfWidth = layout === "thermal" ? 80 : 210;
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const pdfHeight = (imgHeight * pdfWidth) / imgWidth;

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: layout === "thermal" ? [80, Math.max(100, pdfHeight)] : "a4",
      });

      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      pdf.save(`NFCe_${data.invoice.number || "nota"}.pdf`);
    } catch (err) {
      console.error("Falha ao gerar PDF:", err);
      alert("Houve um erro ao gerar o arquivo PDF. Tente usar o botão de Imprimir como alternativa.");
    } finally {
      setGeneratingPdf(false);
    }
  };

  // Browser print window trigger
  const handlePrint = () => {
    window.print();
  };

  // Helper to chunk access key in sets of 4 for standard tax invoice layout
  const formatAccessKey = (key: string) => {
    const clean = key.replace(/\s+/g, "");
    const chunks = [];
    for (let i = 0; i < clean.length; i += 4) {
      chunks.push(clean.substring(i, i + 4));
    }
    return chunks.join(" ");
  };

  return (
    <div className="w-full max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start px-2 sm:px-4 mb-16 animate-fade-in" id="viewer-container">
      {/* Control Panel / Sidebar (Col 1 to 4) */}
      <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-6" id="control-panel">
        <button
          onClick={onBack}
          id="btn-back-to-scan"
          className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 font-medium transition-all group bg-[#0F0F12] hover:bg-[#121215] py-2.5 px-4 rounded-xl border border-white/5 cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5 text-emerald-400" />
          Voltar para Leitura
        </button>

        <div className="bg-[#0F0F12] border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
          <div>
            <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-400" />
              Documento Carregado
            </h2>
            <p className="text-xs text-slate-400">
              NFC-e carregada e convertida em cupom auxiliar para compartilhamento.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2.5" id="action-buttons-group">
            <button
              id="btn-download-pdf-viewer"
              disabled={generatingPdf || isEditing}
              onClick={handleDownloadPdf}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/5 disabled:text-slate-600 text-black font-semibold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2 shadow-md cursor-pointer text-sm"
            >
              {generatingPdf ? (
                <>
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
                  Gerando PDF...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Baixar Cupom em PDF
                </>
              )}
            </button>

            <button
              id="btn-print-viewer"
              disabled={isEditing}
              onClick={handlePrint}
              className="w-full bg-[#121215] hover:bg-[#18181c] text-slate-300 font-medium py-2.5 px-4 rounded-xl border border-white/5 transition-all flex items-center justify-center gap-2 cursor-pointer text-xs shadow-sm"
            >
              <Printer className="w-4 h-4 text-emerald-400" />
              Imprimir Nota
            </button>

            {/* Editing triggers */}
            {!isEditing ? (
              <button
                id="btn-edit-mode"
                onClick={() => {
                  setEditedData({ ...data });
                  setIsEditing(true);
                }}
                className="w-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-semibold py-2.5 px-4 rounded-xl border border-emerald-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer text-xs"
              >
                <Edit2 className="w-3.5 h-3.5" />
                Editar Dados da Nota
              </button>
            ) : (
              <div className="flex gap-2" id="edit-mode-actions">
                <button
                  id="btn-save-edits"
                  onClick={handleSaveEdits}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold py-2.5 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer text-xs shadow-md"
                >
                  <Check className="w-4 h-4" />
                  Salvar
                </button>
                <button
                  id="btn-cancel-edits"
                  onClick={handleCancelEdits}
                  className="flex-1 bg-[#121215] hover:bg-[#18181c] text-slate-300 font-medium py-2.5 px-3 rounded-xl border border-white/5 transition-all flex items-center justify-center gap-1.5 cursor-pointer text-xs"
                >
                  <X className="w-4 h-4 text-red-400" />
                  Cancelar
                </button>
              </div>
            )}
          </div>

          <hr className="border-white/5" />

          {/* Quick Share Grid */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Enviar para Cliente</h3>
            <div className="grid grid-cols-2 gap-2" id="share-buttons-grid">
              <button
                id="btn-share-whatsapp"
                onClick={() => onOpenShare("whatsapp")}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 font-semibold transition-all cursor-pointer text-xs"
              >
                <MessageSquare className="w-4 h-4" />
                WhatsApp
              </button>
              <button
                id="btn-share-email"
                onClick={() => onOpenShare("email")}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-slate-300 bg-[#121215] hover:bg-[#18181c] border border-white/5 font-medium transition-all cursor-pointer text-xs"
              >
                <Mail className="w-4 h-4 text-emerald-400" />
                E-mail
              </button>
            </div>
          </div>

          <hr className="border-white/5" />

          {/* Layout Switcher */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Layout do PDF</h3>
            <div className="flex bg-[#0D0D0F] p-1 rounded-xl border border-white/5" id="layout-switches">
              <button
                id="btn-layout-thermal"
                onClick={() => setLayout("thermal")}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  layout === "thermal"
                    ? "bg-[#121215] text-white shadow-sm border border-white/10"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Bobina Térmica (80mm)
              </button>
              <button
                id="btn-layout-a4"
                onClick={() => setLayout("a4")}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  layout === "a4"
                    ? "bg-[#121215] text-white shadow-sm border border-white/10"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Padrão A4
              </button>
            </div>
          </div>
        </div>

        {/* Card 2: PDF Customization */}
        <div className="bg-[#0F0F12] border border-white/5 rounded-3xl p-6 shadow-2xl space-y-5" id="brand-customization-card">
          <div>
            <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-emerald-400" />
              Personalização do PDF
            </h3>
            <p className="text-[11px] text-slate-400">
              Adicione a identidade da sua marca alterando as cores e inserindo a sua logo.
            </p>
          </div>

          {/* Logo Upload */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 block uppercase tracking-wider">Logotipo da Empresa</label>
            
            {!companyLogo ? (
              <div 
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-2xl p-4 text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-2 ${
                  dragActive 
                    ? "border-emerald-400 bg-[#10b981]/5" 
                    : "border-white/10 bg-[#121215] hover:border-white/20"
                }`}
                onClick={() => document.getElementById("logo-upload-input")?.click()}
              >
                <UploadCloud className="w-8 h-8 text-slate-500" />
                <div>
                  <p className="text-xs font-semibold text-slate-300">Carregar logo</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">Arraste ou clique para selecionar</p>
                </div>
                <input 
                  id="logo-upload-input"
                  type="file" 
                  accept="image/*" 
                  className="hidden" 
                  onChange={handleLogoChange}
                />
              </div>
            ) : (
              <div className="bg-[#121215] border border-white/10 rounded-2xl p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <div className="bg-white p-1 rounded-lg shrink-0 w-10 h-10 flex items-center justify-center">
                    <img src={companyLogo} alt="Logo preview" className="max-w-full max-h-full object-contain" />
                  </div>
                  <span className="text-[11px] text-slate-300 truncate font-mono font-bold">logo_carregada.png</span>
                </div>
                <button 
                  onClick={() => setCompanyLogo(null)}
                  className="p-1.5 hover:bg-white/5 rounded-lg text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                  title="Remover logotipo"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <hr className="border-white/5" />

          {/* Preset Palettes */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-slate-400 block uppercase tracking-wider">Paletas de Cores</label>
            <div className="grid grid-cols-5 gap-1.5">
              {COLOR_PRESETS.map((preset) => {
                const isSelected = 
                  titleColor === preset.title && 
                  textColor === preset.text && 
                  borderColor === preset.border && 
                  valueColor === preset.value && 
                  accentColor === preset.accent;
                return (
                  <button
                    key={preset.name}
                    onClick={() => {
                      setTitleColor(preset.title);
                      setTextColor(preset.text);
                      setBorderColor(preset.border);
                      setValueColor(preset.value);
                      setAccentColor(preset.accent);
                    }}
                    className={`p-1.5 rounded-xl border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      isSelected 
                        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400 font-bold" 
                        : "border-white/5 bg-[#121215] text-slate-400 hover:text-slate-200 hover:bg-[#18181c]"
                    }`}
                    title={preset.name}
                  >
                    <div className="flex -space-x-1.5 mb-0.5">
                      <span className="w-3.5 h-3.5 rounded-full border border-black/40 shadow-sm animate-fade-in" style={{ backgroundColor: preset.title }}></span>
                      <span className="w-3.5 h-3.5 rounded-full border border-black/40 shadow-sm animate-fade-in" style={{ backgroundColor: preset.accent }}></span>
                      <span className="w-3.5 h-3.5 rounded-full border border-black/40 shadow-sm animate-fade-in" style={{ backgroundColor: preset.border }}></span>
                    </div>
                    <span className="text-[9px] font-medium truncate max-w-full">{preset.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <hr className="border-white/5" />

          {/* Custom Color Pickers */}
          <div className="space-y-3.5">
            <label className="text-xs font-bold text-slate-400 block uppercase tracking-wider">Customizar Cores</label>
            <div className="grid grid-cols-2 gap-3">
              {/* Title Color */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-slate-400 block">Títulos e Textos</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="color" 
                    value={titleColor} 
                    onChange={(e) => setTitleColor(e.target.value)}
                    className="w-8 h-8 rounded border-0 cursor-pointer bg-transparent"
                  />
                  <span className="text-[10px] font-mono text-slate-300 uppercase">{titleColor}</span>
                </div>
              </div>

              {/* Border Color */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-slate-400 block">Bordas e Linhas</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="color" 
                    value={borderColor} 
                    onChange={(e) => setBorderColor(e.target.value)}
                    className="w-8 h-8 rounded border-0 cursor-pointer bg-transparent"
                  />
                  <span className="text-[10px] font-mono text-slate-300 uppercase">{borderColor}</span>
                </div>
              </div>

              {/* Value Color */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-slate-400 block">Valores e Totais</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="color" 
                    value={valueColor} 
                    onChange={(e) => setValueColor(e.target.value)}
                    className="w-8 h-8 rounded border-0 cursor-pointer bg-transparent"
                  />
                  <span className="text-[10px] font-mono text-slate-300 uppercase">{valueColor}</span>
                </div>
              </div>

              {/* Accent Color */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-slate-400 block">Descontos</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="color" 
                    value={accentColor} 
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="w-8 h-8 rounded border-0 cursor-pointer bg-transparent"
                  />
                  <span className="text-[10px] font-mono text-slate-300 uppercase">{accentColor}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* DANFE NFC-e Render Viewport (Col 5 to 12) */}
      <div className="lg:col-span-8 flex justify-center animate-fade-in" id="receipt-viewport">
        {/* Printable wrapper */}
        <div 
          ref={receiptRef}
          id="printable-receipt"
          className={`bg-white text-slate-950 font-sans shadow-2xl border border-slate-200 transition-all duration-300 overflow-hidden ${
            layout === "thermal" 
              ? "w-[340px] px-5 py-8 text-[11px] leading-relaxed select-text" 
              : "w-full max-w-[800px] aspect-[1/1.414] px-12 py-16 text-xs leading-relaxed select-text"
          }`}
        >
          {/* Custom style injected for local thermal layout font matching if desired */}
          <style>{`
            #printable-receipt {
              font-family: 'Inter', system-ui, -apple-system, sans-serif;
            }
            .fiscal-font {
              font-family: 'JetBrains Mono', 'Fira Code', monospace;
            }
            @media print {
              body * {
                visibility: hidden !important;
                background: transparent !important;
              }
              #printable-receipt, #printable-receipt * {
                visibility: visible !important;
              }
              #printable-receipt {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                max-width: 100% !important;
                box-shadow: none !important;
                border: none !important;
                padding: 0 !important;
                margin: 0 !important;
              }
            }
          `}</style>

          {/* Receipt Header */}
          <div 
            className="text-center space-y-2 mb-4 border-b-2 border-dashed pb-4 transition-colors duration-200"
            style={{ borderColor: borderColor }}
          >
            {companyLogo && (
              <div className="flex justify-center mb-4 mt-1">
                <img 
                  src={companyLogo} 
                  alt="Logotipo da Empresa" 
                  className="max-h-20 max-w-[200px] object-contain" 
                  referrerPolicy="no-referrer"
                />
              </div>
            )}

            {isEditing ? (
              <div className="space-y-2 text-left bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/20 mb-2">
                <span className="text-[10px] font-bold text-emerald-600 block uppercase tracking-wider">Dados do Estabelecimento</span>
                <input
                  type="text"
                  placeholder="Nome Fantasia / Razão Social"
                  value={editedData.issuer.name}
                  onChange={(e) => handleIssuerChange("name", e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded px-2.5 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="CNPJ"
                  value={editedData.issuer.cnpj}
                  onChange={(e) => handleIssuerChange("cnpj", e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded px-2.5 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="Endereço Completo"
                  value={editedData.issuer.address}
                  onChange={(e) => handleIssuerChange("address", e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded px-2.5 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Inscrição Estadual"
                    value={editedData.issuer.ie || ""}
                    onChange={(e) => handleIssuerChange("ie", e.target.value)}
                    className="bg-white border border-slate-200 rounded px-2.5 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="UF"
                    value={editedData.issuer.state}
                    onChange={(e) => handleIssuerChange("state", e.target.value)}
                    className="bg-white border border-slate-200 rounded px-2.5 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
            ) : (
              <>
                <h1 
                  className="text-xs sm:text-sm font-bold uppercase tracking-tight max-w-[280px] mx-auto leading-tight text-slate-900 transition-colors duration-200"
                  style={{ color: titleColor }}
                >
                  {data.issuer.name}
                </h1>
                <div 
                  className="text-[10px] text-slate-600 space-y-0.5 transition-colors duration-200"
                  style={{ color: textColor }}
                >
                  <p className="font-medium">CNPJ: {data.issuer.cnpj} {data.issuer.ie ? `| IE: ${data.issuer.ie}` : ""}</p>
                  <p className="max-w-[260px] mx-auto text-slate-500 leading-normal" style={{ color: textColor }}>{data.issuer.address}</p>
                </div>
              </>
            )}

            <div className="pt-2">
              <div 
                className="border py-1 px-2 uppercase text-[9px] font-bold tracking-wider rounded-md transition-colors duration-200"
                style={{ color: titleColor, borderColor: borderColor, backgroundColor: `${accentColor}08` }}
              >
                DANFE NFC-e - Documento Auxiliar
                <br />
                da Nota Fiscal de Consumidor Eletrônica
              </div>
            </div>
          </div>

          {/* Items Table Header */}
          <div 
            className="border-b pb-1 mb-2 transition-colors duration-200"
            style={{ borderColor: borderColor }}
          >
            <div
              className="grid grid-cols-12 gap-1 text-[9px] font-bold uppercase transition-colors duration-200"
              style={{ color: textColor }}
            >
              <div className="col-span-1">#</div>
              <div className="col-span-5">Descrição</div>
              <div className="col-span-1 text-center">Un</div>
              <div className="col-span-1 text-right">Qtd</div>
              <div className="col-span-2 text-right">Vl Un</div>
              <div className="col-span-2 text-right">Total</div>
            </div>
          </div>

          {/* Items List */}
          <div 
            className="space-y-2 mb-4 border-b border-dashed pb-4 transition-colors duration-200" 
            id="items-invoice-list"
            style={{ borderColor: borderColor }}
          >
            {(isEditing ? editedData.items : data.items).map((item, idx) => (
              <div key={idx} className="text-[10px] items-start py-0.5" id={`invoice-item-row-${idx}`}>
                {isEditing ? (
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-1.5 mb-2 relative">
                    <button
                      id={`btn-delete-item-${idx}`}
                      onClick={() => handleDeleteItem(idx)}
                      className="absolute right-2 top-2 text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-100 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <div className="grid grid-cols-12 gap-1.5">
                      <div className="col-span-2">
                        <label className="text-[8px] font-bold text-slate-500 block uppercase">Cod</label>
                        <input
                          type="text"
                          value={item.code}
                          onChange={(e) => handleItemChange(idx, "code", e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded px-1 py-0.5 text-[9px] focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                        />
                      </div>
                      <div className="col-span-10">
                        <label className="text-[8px] font-bold text-slate-500 block uppercase">Descrição do Produto</label>
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => handleItemChange(idx, "description", e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[9px] focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      <div>
                        <label className="text-[8px] font-bold text-slate-500 block uppercase">Unidade</label>
                        <input
                          type="text"
                          value={item.unit}
                          onChange={(e) => handleItemChange(idx, "unit", e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[9px] text-center focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[8px] font-bold text-slate-500 block uppercase">Qtd</label>
                        <input
                          type="number"
                          step="any"
                          value={item.qty}
                          onChange={(e) => handleItemChange(idx, "qty", e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[9px] text-right focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[8px] font-bold text-slate-500 block uppercase">Unitário (R$)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(e) => handleItemChange(idx, "unitPrice", e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[9px] text-right focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[8px] font-bold text-slate-500 block uppercase">Total (R$)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={item.totalPrice}
                          onChange={(e) => handleItemChange(idx, "totalPrice", e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[9px] text-right font-semibold focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-12 gap-1 font-medium transition-colors duration-200">
                    <div className="col-span-1 text-[9px]" style={{ color: textColor }}>{idx + 1}</div>
                    <div className="col-span-5 truncate font-medium uppercase text-slate-900" style={{ color: titleColor }}>{item.description}</div>
                    <div className="col-span-1 text-center" style={{ color: textColor }}>{item.unit}</div>
                    <div className="col-span-1 text-right fiscal-font" style={{ color: textColor }}>{item.qty.toFixed(layout === "thermal" ? 1 : 2)}</div>
                    <div className="col-span-2 text-right fiscal-font" style={{ color: textColor }}>{item.unitPrice.toFixed(2)}</div>
                    <div className="col-span-2 text-right font-semibold fiscal-font" style={{ color: valueColor }}>{item.totalPrice.toFixed(2)}</div>
                  </div>
                )}
                {!isEditing && item.code && (
                  <div className="grid grid-cols-12 gap-1 text-[8px] leading-none mb-1 font-mono transition-colors duration-200" style={{ color: textColor }}>
                    <div className="col-span-1"></div>
                    <div className="col-span-11 uppercase">Cód: {item.code}</div>
                  </div>
                )}
              </div>
            ))}

            {isEditing && (
              <button
                id="btn-add-item-row"
                onClick={handleAddItem}
                className="w-full bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 py-2 rounded-xl text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Adicionar Novo Item
              </button>
            )}
          </div>

          {/* Totals Section */}
          <div 
            className="space-y-1.5 mb-6 border-b-2 border-dashed pb-4 transition-colors duration-200"
            style={{ borderColor: borderColor }}
          >
            {isEditing ? (
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                <span className="text-[10px] font-bold text-slate-500 block uppercase tracking-wider">Totais & Pagamento</span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[8px] font-bold text-slate-500 block uppercase">Desconto (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editedData.totals.discount}
                      onChange={(e) => {
                        const disc = parseFloat(e.target.value) || 0;
                        const totals = recalculateTotals(editedData.items, disc, editedData.totals.paymentType);
                        setEditedData({ ...editedData, totals });
                      }}
                      className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs text-right focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[8px] font-bold text-slate-500 block uppercase">Tipo Pagamento</label>
                    <input
                      type="text"
                      value={editedData.totals.paymentType}
                      onChange={(e) => {
                        const totals = { ...editedData.totals, paymentType: e.target.value };
                        setEditedData({ ...editedData, totals });
                      }}
                      className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex justify-between items-center bg-white p-2 rounded border border-slate-200 mt-1">
                  <span className="text-xs font-bold text-slate-700">Total Líquido:</span>
                  <span className="text-sm font-extrabold text-slate-900 fiscal-font">
                    R$ {editedData.totals.total.toFixed(2)}
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="flex justify-between text-[10px] transition-colors duration-200" style={{ color: textColor }}>
                  <span className="uppercase">QTD. TOTAL DE ITENS</span>
                  <span className="font-bold fiscal-font" style={{ color: titleColor }}>{data.items.reduce((sum, item) => sum + item.qty, 0)}</span>
                </div>
                <div className="flex justify-between text-[10px] transition-colors duration-200" style={{ color: textColor }}>
                  <span className="uppercase">VALOR TOTAL BRUTO</span>
                  <span className="font-bold fiscal-font" style={{ color: titleColor }}>R$ {data.totals.subtotal.toFixed(2)}</span>
                </div>
                {data.totals.discount > 0 && (
                  <div className="flex justify-between text-[10px] font-semibold transition-colors duration-200" style={{ color: accentColor }}>
                     <span className="uppercase">DESCONTO</span>
                    <span className="fiscal-font">- R$ {data.totals.discount.toFixed(2)}</span>
                  </div>
                )}
                <div 
                  className="flex justify-between text-xs font-extrabold pt-1 border-t transition-colors duration-200"
                  style={{ borderColor: borderColor }}
                >
                  <span className="uppercase pt-1" style={{ color: titleColor }}>VALOR A PAGAR</span>
                  <span 
                    className="fiscal-font text-[13px] px-1.5 py-0.5 rounded transition-all duration-200"
                    style={{ color: valueColor, backgroundColor: `${accentColor}12` }}
                  >
                    R$ {data.totals.total.toFixed(2)}
                  </span>
                </div>
                
                {/* Payment Detail */}
                <div className="flex justify-between text-[10px] pt-2 font-medium transition-colors duration-200" style={{ color: textColor }}>
                  <span className="uppercase">FORMA DE PAGAMENTO</span>
                  <span className="uppercase font-bold" style={{ color: titleColor }}>{data.totals.paymentType || "Dinheiro / Cartão"}</span>
                </div>
                {data.totals.icms && data.totals.icms > 0 ? (
                  <div className="text-[8px] mt-2 text-center leading-normal transition-colors duration-200" style={{ color: textColor }}>
                    Tributos aproximados Incidentes (Lei Federal 12.741/2012): R$ {data.totals.icms.toFixed(2)} ({((data.totals.icms / data.totals.total) * 100).toFixed(1)}%)
                  </div>
                ) : null}
              </>
            )}
          </div>

          {/* Audit Metadata (Access Key, Date, Numbers) */}
          <div 
            className="space-y-3 text-[9px] mb-6 pb-4 border-b border-dashed transition-colors duration-200"
            style={{ color: textColor, borderColor: borderColor }}
          >
            {isEditing ? (
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2 text-left">
                <span className="text-[10px] font-bold text-slate-500 block uppercase tracking-wider">Metadados da Nota</span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[8px] font-bold text-slate-500 block uppercase">Número da Nota</label>
                    <input
                      type="text"
                      value={editedData.invoice.number}
                      onChange={(e) => handleInvoiceChange("number", e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[8px] font-bold text-slate-500 block uppercase">Série</label>
                    <input
                      type="text"
                      value={editedData.invoice.series}
                      onChange={(e) => handleInvoiceChange("series", e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs text-center focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[8px] font-bold text-slate-500 block uppercase">Chave de Acesso (44 dígitos)</label>
                  <input
                    type="text"
                    value={editedData.invoice.accessKey}
                    onChange={(e) => handleInvoiceChange("accessKey", e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[11px] font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[8px] font-bold text-slate-500 block uppercase">Data de Emissão</label>
                  <input
                    type="text"
                    value={editedData.invoice.emissionDate}
                    onChange={(e) => handleInvoiceChange("emissionDate", e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[8px] font-bold text-slate-500 block uppercase">Protocolo de Autorização</label>
                  <input
                    type="text"
                    value={editedData.invoice.protocol || ""}
                    onChange={(e) => handleInvoiceChange("protocol", e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-center sm:text-left transition-colors duration-200">
                <div className="flex flex-col sm:flex-row sm:justify-between" style={{ color: textColor }}>
                  <span>NÚMERO: <strong className="font-bold" style={{ color: titleColor }}>{data.invoice.number}</strong></span>
                  <span>SÉRIE: <strong className="font-bold" style={{ color: titleColor }}>{data.invoice.series}</strong></span>
                  <span>DATA EMISSÃO: <strong className="font-bold" style={{ color: titleColor }}>{
                    // Slice first 19 chars for cleaner ISO standard string parsing
                    data.invoice.emissionDate.includes("T") 
                      ? new Date(data.invoice.emissionDate.substring(0, 19)).toLocaleString("pt-BR")
                      : data.invoice.emissionDate
                  }</strong></span>
                </div>
                {data.invoice.protocol && (
                  <p style={{ color: textColor }}>
                    PROTOCOLO DE AUTORIZAÇÃO: <strong className="font-bold" style={{ color: titleColor }}>{data.invoice.protocol}</strong>
                  </p>
                )}

                <div className="pt-2">
                  <span className="block text-[8px] uppercase tracking-wider font-bold mb-1" style={{ color: textColor }}>Chave de Acesso (Consulte no site do SEFAZ)</span>
                  <div 
                    className="border p-2 rounded-md font-mono text-[10px] font-bold tracking-wide text-center bg-slate-50/50 transition-all duration-200"
                    style={{ color: titleColor, borderColor: borderColor }}
                  >
                    {formatAccessKey(data.invoice.accessKey)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Barcode representation */}
          <div className="flex flex-col items-center justify-center space-y-1 mb-4 select-none">
            <span className="text-[8px] tracking-widest font-mono uppercase" style={{ color: textColor }}>Assinatura Digital Fiscal</span>
            {/* Visual HTML Barcode bars */}
            <div className="flex items-end justify-center h-10 w-full max-w-xs gap-[1px] bg-white pt-1">
              {Array.from({ length: 55 }).map((_, i) => {
                const heights = ["h-full", "h-5/6", "h-4/5", "h-3/4"];
                const widths = ["w-[1px]", "w-[2px]", "w-[1px]"];
                const seed = (i * 7 + 13) % 100;
                const h = heights[seed % heights.length];
                const w = widths[seed % widths.length];
                const bg = seed % 4 === 0 ? "bg-transparent" : "bg-slate-900";
                return <div key={i} className={`${h} ${w} ${bg}`} style={bg !== "bg-transparent" ? { backgroundColor: titleColor } : undefined}></div>;
              })}
            </div>
            <span className="text-[8px] font-mono tracking-wider" style={{ color: textColor }}>NFCE-E CONVERSÃO AUXILIAR DE EMISSÃO</span>
          </div>

          {/* Sefaz Consulta Link Information */}
          <div 
            className="text-center text-[9px] leading-normal border-t pt-3 transition-colors duration-200"
            style={{ color: textColor, borderColor: borderColor }}
          >
            <p>Consulte pela chave de acesso em seu portal estadual da SEFAZ.</p>
            <p className="font-semibold mt-1" style={{ color: titleColor }}>Obrigado pela preferência!</p>
          </div>
        </div>
      </div>
    </div>
  );
}

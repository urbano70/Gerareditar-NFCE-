import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Ensure all unhandled errors from async routes still return JSON
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("[Express Error Handler]", err);
  if (!res.headersSent) {
    res.status(500).json({ error: err.message || "Erro interno do servidor." });
  }
});

const geminiApiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;

if (geminiApiKey) {
  ai = new GoogleGenAI({ apiKey: geminiApiKey, httpOptions: { headers: { "User-Agent": "aistudio-build" } } });
  console.log("Gemini API initialized successfully.");
} else {
  console.warn("⚠️  GEMINI_API_KEY não configurada. Modo de demonstração ativo.");
}

// ---------- Helpers ----------

function cleanHtml(html: string): string {
  let text = html;
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  text = text.replace(/\s+/g, " ");
  if (text.length > 250000) text = text.substring(0, 250000) + "... [Truncado]";
  return text;
}

/** Convert HTML to structured plain text.
 * Table rows (<tr>) and block elements become newlines;
 * table cells (<td>/<th>) become spaces (keeping row data on one line).
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    // Block-level breaks → newline
    .replace(/<\/?(tr|div|p|li|section|article|h[1-6])\b[^>]*>/gi, "\n")
    // Table cells → space (keep row on same line)
    .replace(/<\/?(td|th|span|a|strong|b|em|i)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#\d+;/gi, " ")
    .replace(/[^\S\n]+/g, " ")
    .split("\n").map(l => l.trim()).filter(Boolean).join("\n");
}

const parseNum = (s: string) => parseFloat(s.replace(/\./g, "").replace(",", "."));

/**
 * Parse SEFAZ NFC-e portal HTML directly — no AI needed.
 * Returns structured NFCeData or null if insufficient data could be extracted.
 */
function parseSefazHtml(rawHtml: string, accessKey: string | null, qrUrl?: string): any | null {
  try {
    const text = htmlToText(rawHtml);
    const lines = text.split("\n");

    // ── 1. CNPJ ──────────────────────────────────────────────────────────────
    const cnpjMatch = text.match(/(\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]\d{4}[-\s]?\d{2})/);
    if (!cnpjMatch) return null;
    const cnpj = cnpjMatch[1].replace(/\s/g, "");

    // ── 2. Access key (may be formatted with spaces) ──────────────────────────
    const keyRaw = text.match(/\b(\d[\d ]{42,57}\d)\b/);
    const extractedKey = keyRaw ? keyRaw[1].replace(/\s/g, "") : null;
    const finalKey = accessKey || (extractedKey?.length === 44 ? extractedKey : null);
    const keyMeta = finalKey ? parseAccessKey(finalKey) : null;
    const state = keyMeta?.state || "SP";

    // ── 3. Invoice metadata ───────────────────────────────────────────────────
    const numberMatch = text.match(/(?:n[ºo°úu]mero|n[º°]\.?|nfce?)[:\s]+0*(\d+)/i);
    const seriesMatch = text.match(/s[eé]rie[:\s]+0*(\d+)/i);
    const number = numberMatch ? numberMatch[1] : (keyMeta?.number || "1");
    const series  = seriesMatch ? seriesMatch[1] : (keyMeta?.series  || "1");

    const dateMatch = text.match(/(\d{2})[/.-](\d{2})[/.-](\d{4})\s+(\d{2}:\d{2})/);
    const emissionDate = dateMatch
      ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}T${dateMatch[4]}:00`
      : (keyMeta?.emissionDate || new Date().toISOString().slice(0, 19));

    const protocolMatch = text.match(/(?:protocolo|autoriza)[:\s]+(\d{15,20})/i);
    const protocol = protocolMatch?.[1];

    // ── 4. Store name (last meaningful line before CNPJ) ─────────────────────
    const cnpjPos = text.indexOf(cnpjMatch[0]);
    const beforeCnpj = text.substring(0, cnpjPos).split("\n").reverse();
    let storeName = "";
    for (const line of beforeCnpj) {
      const c = line.trim();
      if (c.length > 5 && c.length < 100 && /[a-zA-ZÀ-ÿ]/.test(c) && !/cnpj|cpf|\bIE\b|endere/i.test(c)) {
        storeName = c;
        break;
      }
    }

    // ── 5. Address ────────────────────────────────────────────────────────────
    const addrMatch =
      text.match(/(?:endere[çc]o|logradouro)[:\s]*([^\n]{10,150})/i) ||
      text.match(/((?:R(?:ua|\.)|Av(?:enida|\.)?|Estr(?:ada)?\.?|Rod(?:ovia)?\.?|Al(?:ameda)?\.?|Pra[çc]a)\s[^\n]{5,120})/i);
    const address = addrMatch ? addrMatch[1].trim() : `Capital - ${state}`;

    // ── 6. IE ────────────────────────────────────────────────────────────────
    const ieMatch = text.match(/IE[:\s]+(\d[\d./-]{5,20})/i);
    const ie = ieMatch?.[1];

    // ── 7. Items ──────────────────────────────────────────────────────────────
    const items: any[] = [];
    const UNITS = "UN|KG|L|LT|PC|CX|GR|ML|M|MT|PAR|FD|DZ|SC|RL|G|KIT|CJ|BD|FR|PT|CT|AM|VD|GF|P[ÇC]|JG";
    const itemPat = new RegExp(
      `([A-ZÀ-Ÿ][A-ZÀ-Ÿ0-9\\s\\-\\.\\/,()%+*&@#!]+?)\\s+(\\d+(?:[.,]\\d+)?)\\s+(${UNITS})(?:\\s+(?:Vl\\s+Un\\.?[:\\s]*)?(?:R\\$\\s*)?(\\d+(?:[.,]\\d{3})*[.,]\\d{2}))?\\s+(?:R\\$\\s*)?(\\d+(?:[.,]\\d{3})*[.,]\\d{2})`,
      "gi"
    );
    let m: RegExpExecArray | null;
    while ((m = itemPat.exec(text)) !== null) {
      const desc = m[1].trim();
      if (desc.length < 3 || desc.length > 80) continue;
      const qty = parseFloat(m[2].replace(",", "."));
      const unit = m[3].toUpperCase();
      const totalPrice = parseNum(m[5]);
      const unitPrice = m[4] ? parseNum(m[4]) : parseFloat((totalPrice / qty).toFixed(2));
      if (qty > 0 && totalPrice > 0) {
        items.push({ code: "", description: desc, qty, unit, unitPrice, totalPrice });
      }
    }

    if (items.length === 0) {
      console.log("[parseSefazHtml] Nenhum item encontrado — parser falhou.");
      return null;
    }

    // ── 8. Totals ─────────────────────────────────────────────────────────────
    const totalMatch    = text.match(/(?:valor\s+total|total\s+geral|total\s+da\s+nota)\s*[:\s]*(?:R\$\s*)?(\d+(?:[.,]\d{3})*[.,]\d{2})/i);
    const subtotalMatch = text.match(/(?:subtotal|sub[\s-]total|valor\s+dos\s+itens)\s*[:\s]*(?:R\$\s*)?(\d+(?:[.,]\d{3})*[.,]\d{2})/i);
    const discountMatch = text.match(/desconto[s]?\s*[:\s]*(?:R\$\s*)?(\d+(?:[.,]\d{3})*[.,]\d{2})/i);
    const paymentMatch  = text.match(/(?:pix|cart[ãa]o\s+de\s+d[eé]bito|cart[ãa]o\s+de\s+cr[eé]dito|din(?:heiro)?|transfer[eê]ncia|voucher|cheque|credi[aá]rio|vale\s+(?:alimenta[çc][aã]o|refei[çc][aã]o))/i);

    const computedSub = items.reduce((s, i) => s + i.totalPrice, 0);
    const subtotal    = subtotalMatch ? parseNum(subtotalMatch[1]) : computedSub;
    const discount    = discountMatch ? parseNum(discountMatch[1]) : 0;
    const total       = totalMatch    ? parseNum(totalMatch[1])    : parseFloat((subtotal - discount).toFixed(2));
    const paymentType = paymentMatch?.[0] || "Outros";

    console.log(`[parseSefazHtml] ✅ ${items.length} itens extraídos. Total: R$ ${total.toFixed(2)}`);

    return {
      issuer: { name: storeName || `Estabelecimento - ${state}`, cnpj, address, state, ie },
      invoice: { accessKey: finalKey || "", number, series, emissionDate, protocol },
      items,
      totals: {
        subtotal: parseFloat(subtotal.toFixed(2)),
        discount: parseFloat(discount.toFixed(2)),
        icms: parseFloat((total * 0.12).toFixed(2)),
        total: parseFloat(total.toFixed(2)),
        paymentType,
      },
      qrCodeUrl: qrUrl,
    };
  } catch (err) {
    console.error("[parseSefazHtml] Erro:", err);
    return null;
  }
}

/** Parse plain text extracted from a NFC-e PDF (pdfjs-dist output). */
function parsePdfText(rawText: string): any | null {
  try {
    const t = rawText.replace(/\r?\n/g, " ").replace(/\s{2,}/g, " ").trim();
    if (t.length < 60) return null;

    console.log(`[parsePdfText] ${t.length} chars. Preview: "${t.substring(0, 200)}"`);

    // ── CNPJ: try with "CNPJ" label first, then bare formatted pattern ────────
    const cnpjMatch =
      t.match(/CNPJ[/.\s:]*(\d{2}\.?\d{3}\.?\d{3}[\/.]\d{4}-?\d{2})/i) ||
      t.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/); // formatted, no label

    if (!cnpjMatch) {
      console.log("[parsePdfText] CNPJ não encontrado — abortando");
      return null;
    }
    const rawCnpjDigits = cnpjMatch[1].replace(/\D/g, "");
    const cnpj = rawCnpjDigits.length === 14
      ? rawCnpjDigits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
      : cnpjMatch[1];
    console.log(`[parsePdfText] CNPJ: ${cnpj}`);

    // ── IE ────────────────────────────────────────────────────────────────────
    const ieMatch = t.match(/(?:IE|Insc\.?\s*Est\.?)[:\s-]+(\d[\d./-]{3,20})/i);
    const ie = ieMatch?.[1];

    // ── Access key (44 digits, sometimes in groups of 4) ─────────────────────
    const keyGroupMatch = t.match(/(\d{4}(?:\s\d{4}){10})/);
    const keyRawMatch   = t.match(/\b(\d{44})\b/);
    const rawKey   = keyGroupMatch?.[1] || keyRawMatch?.[1] || "";
    const accessKey = rawKey.replace(/\s/g, "");
    const keyMeta  = accessKey.length === 44 ? parseAccessKey(accessKey) : null;

    // ── State ─────────────────────────────────────────────────────────────────
    const stateMatch = t.match(/[-–,]\s*([A-Z]{2})\s*[,\s-]*(?:CEP\b|\d{5}-?\d{3})/);
    const state = stateMatch?.[1] || keyMeta?.state || "SP";

    // ── Store name + address (everything before CNPJ label) ──────────────────
    const cnpjPos    = t.indexOf(cnpjMatch[0]);
    const beforeCnpj = t.substring(0, cnpjPos).trim();
    let storeName = "";
    let address   = "";
    const addrIdx = beforeCnpj.search(/\b(?:RUA\b|R\.\s|AV[.\s]|AVENIDA\b|ESTRADA\b|ESTR\.\s|RODOVIA\b|ROD\.\s|ALAMEDA\b|AL\.\s|PRA[ÇC]A\b|QUADRA\b|QD\.\s|SQN\b|SCLN\b|SETOR\b|TRAVESSA\b|TRAV\.\s)/i);
    if (addrIdx > 0) {
      storeName = beforeCnpj.substring(0, addrIdx).trim();
      address   = beforeCnpj.substring(addrIdx).trim();
    } else {
      storeName = beforeCnpj.replace(/\s+/g, " ").trim().substring(0, 100);
    }

    // ── Invoice metadata ──────────────────────────────────────────────────────
    const numberMatch = t.match(/N[uú]mero[:\s]+0*(\d+)/i);
    const seriesMatch = t.match(/S[eé]rie[:\s]+0*(\d+)/i);
    const number = numberMatch ? numberMatch[1].replace(/\./g, "") : (keyMeta?.number || "1");
    const series = seriesMatch ? seriesMatch[1] : (keyMeta?.series || "1");

    const dateMatch =
      t.match(/Emiss[aã]o[:\s]+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)/i) ||
      t.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
    const rawTime = dateMatch?.[4] || "00:00:00";
    const emissionDate = dateMatch
      ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}T${rawTime.length === 5 ? rawTime + ":00" : rawTime}`
      : (keyMeta?.emissionDate || new Date().toISOString().slice(0, 19));

    const protocolMatch = t.match(/Protocolo\s+de\s+Autoriza[çc][aã]o[:\s]+(\d{10,20})/i);
    const protocol = protocolMatch?.[1];

    const cpfMatch = t.match(/CPF[:\s]+(\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2})/i);
    const consumer = cpfMatch
      ? { cpf: cpfMatch[1].replace(/[\s.]/g, "").replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") }
      : undefined;

    // ── Item section: from first VL.TOTAL header to totals block ─────────────
    const allHeaderMatches = [...t.matchAll(/VL\.?\s*TOTAL\b/gi)];
    const headerMatch = allHeaderMatches[0];
    const headerEndIdx = headerMatch ? (headerMatch.index! + headerMatch[0].length) : -1;

    const totalsStart = t.search(/Qtd\.?\s*Total\s+de\s+Itens|Valor\s+Total\b[:\s]+R?\$?/i);
    const itemSection = headerEndIdx > -1
      ? t.substring(headerEndIdx, totalsStart > headerEndIdx ? totalsStart : headerEndIdx + 2000).trim()
      : t;

    console.log(`[parsePdfText] itemSection (${itemSection.length} chars): "${itemSection.substring(0, 150)}"`);

    // ── Items: QTD accepts integer or 1-4 decimal places (fixes "1 UN" case) ──
    const items: any[] = [];
    const UNIT_PAT = "UN|KG|LT|L|PC|CX|GR|ML|MT|M|PAR|FD|DZ|SC|RL|G|KIT|CJ|BD|FR|PT|CT|AM|VD|GF|P[ÇC]|JG";
    const itemRe = new RegExp(
      `(?:^|\\s)(?:\\d{1,8}\\s+)?` +
      `([A-ZÀ-Ÿa-zà-ÿ][\\wÀ-ÿ \\-\\.\\/()%+*&@!]{1,70}?)` +
      `\\s+(\\d+(?:[,.]\\d{1,4})?)` +
      `\\s+(${UNIT_PAT})\\b` +
      `\\s+(\\d+(?:[,.]\\d{3})*[,.]\\d{2,3})` +
      `\\s+(\\d+(?:[,.]\\d{3})*[,.]\\d{2,3})`,
      "gi"
    );
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(itemSection)) !== null) {
      const desc = m[1].trim();
      if (desc.length < 2 || desc.length > 80) continue;
      if (/^(DANFE|SEFAZ|COD\b|QTD\b|VL\.|DESCRI[ÇC]|CONSUMIDOR|PROTOCOLO|PROCON|EMISS|FORMA\s+DE|VALOR\s+(?:TOTAL|DESC))/i.test(desc)) continue;
      const qty = parseFloat(m[2].replace(",", "."));
      const unit = m[3].toUpperCase();
      const unitPrice  = parseNum(m[4]);
      const totalPrice = parseNum(m[5]);
      if (qty > 0 && totalPrice > 0) {
        items.push({ code: "", description: desc.toUpperCase(), qty, unit, unitPrice, totalPrice });
      }
    }

    console.log(`[parsePdfText] ${items.length} itens encontrados`);

    // ── Totals ────────────────────────────────────────────────────────────────
    const totalValMatch = t.match(/Valor\s+Total\b[:\s]*R?\$?\s*([\d.,]+)/i);
    const discValMatch  = t.match(/(?:Valor\s+)?Desconto[:\s]*R?\$?\s*([\d.,]+)/i);
    const payMatch      = t.match(/(?:PIX(?:\s*[-–]\s*[\wÀ-ÿ]+)?|Pix\b|Cart[aã]o\s+de\s+(?:D[eé]bito|Cr[eé]dito)|Dinheiro|Transfer[eê]ncia|Boleto)/i);

    const computedSub = items.reduce((s: number, i: any) => s + i.totalPrice, 0);
    const discount    = discValMatch ? parseNum(discValMatch[1]) : 0;
    const total       = totalValMatch ? parseNum(totalValMatch[1]) : parseFloat((computedSub - discount).toFixed(2));
    const paymentType = payMatch?.[0]?.trim().replace(/\s+/g, " ") || "Outros";

    console.log(`[parsePdfText] ✅ CNPJ=${cnpj} itens=${items.length} total=R$${total.toFixed(2)}`);

    return {
      issuer: { name: storeName || `Estabelecimento - ${state}`, cnpj, address: address || `Capital - ${state}`, state, ie },
      invoice: { accessKey, number, series, emissionDate, protocol },
      items,
      totals: {
        subtotal: parseFloat(computedSub.toFixed(2)),
        discount: parseFloat(discount.toFixed(2)),
        icms:     parseFloat((total * 0.12).toFixed(2)),
        total:    parseFloat(total.toFixed(2)),
        paymentType,
      },
      consumer,
    };
  } catch (err) {
    console.error("[parsePdfText] Erro:", err);
    return null;
  }
}

function extractAccessKeyFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const p = urlObj.searchParams.get("p") || urlObj.searchParams.get("chNFe") || urlObj.searchParams.get("chave");
    if (p) {
      const cleanKey = p.split("|")[0];
      if (/^\d{44}$/.test(cleanKey)) return cleanKey;
    }
    const match = url.match(/\b\d{44}\b/);
    if (match) return match[0];
  } catch {
    const match = url.match(/p=(\d{44})/i) || url.match(/chNFe=(\d{44})/i) || url.match(/\b\d{44}\b/);
    if (match) return match[1] || match[0];
  }
  return null;
}

function parseAccessKey(key: string) {
  if (!key || key.replace(/\D/g, "").length !== 44) return null;
  const cleanKey = key.replace(/\D/g, "");
  const stateCode = cleanKey.substring(0, 2);
  const year = "20" + cleanKey.substring(2, 4);
  const month = cleanKey.substring(4, 6);
  const rawCnpj = cleanKey.substring(6, 20);
  const series = parseInt(cleanKey.substring(22, 25), 10).toString();
  const number = parseInt(cleanKey.substring(25, 34), 10).toString();
  const stateMap: Record<string, string> = {
    "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
    "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL",
    "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP",
    "41": "PR", "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF",
  };
  const state = stateMap[stateCode] || "SP";
  const formattedCnpj = rawCnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  return { state, cnpj: formattedCnpj, series, number, emissionDate: `${year}-${month}-15T10:30:00` };
}

// Demo NFC-e generator used when API key is missing or Gemini fails completely
function generateDemoNFCe(hint?: { state?: string; cnpj?: string; number?: string; series?: string; emissionDate?: string; accessKey?: string }) {
  const state = hint?.state || "SP";
  const storeNames: Record<string, string> = {
    SP: "Supermercado São Paulo Ltda.", RJ: "Mercadinho Carioca ME.", MG: "Armazém Mineiro Eireli",
    RS: "Mercado Gaúcho Ltda.", PR: "Supermercado Paranaense ME.", BA: "Mercado da Bahia Ltda.",
    DF: "Supermercado Planalto ME.",
  };
  const addresses: Record<string, string> = {
    SP: "Av. Paulista, 1234, Bela Vista, São Paulo - SP, CEP 01310-100",
    RJ: "Rua da Carioca, 456, Centro, Rio de Janeiro - RJ, CEP 20051-000",
    MG: "Av. Afonso Pena, 789, Centro, Belo Horizonte - MG, CEP 30130-001",
    RS: "Rua dos Andradas, 321, Centro, Porto Alegre - RS, CEP 90020-000",
    PR: "Av. Marechal Floriano Peixoto, 654, Centro, Curitiba - PR, CEP 80010-130",
    BA: "Rua Chile, 55, Centro Histórico, Salvador - BA, CEP 40020-050",
    DF: "SCLN 201, Bloco B, Loja 12, Asa Norte, Brasília - DF, CEP 70833-510",
  };
  const storeName = storeNames[state] || `Mercado Central ${state} Ltda.`;
  const address = addresses[state] || `Av. Principal, 100, Centro, Capital - ${state}, CEP 00000-000`;
  const cnpj = hint?.cnpj || "12.345.678/0001-99";
  const accessKey = hint?.accessKey || "35" + new Date().getFullYear().toString().slice(-2) + "0115" + "12345678000199" + "65" + "001" + "000000001" + "1" + "00000000";
  const number = hint?.number || "000000001";
  const series = hint?.series || "001";
  const emissionDate = hint?.emissionDate || new Date().toISOString().slice(0, 19);

  const items = [
    { code: "7891000100103", description: "ARROZ TIPO 1 BRANCO 5KG", qty: 2, unit: "UN", unitPrice: 24.90, totalPrice: 49.80 },
    { code: "7896006739636", description: "FEIJAO CARIOCA TIPO 1 1KG", qty: 1, unit: "UN", unitPrice: 8.49, totalPrice: 8.49 },
    { code: "7891025100059", description: "OLEO DE SOJA REFINADO 900ML", qty: 2, unit: "UN", unitPrice: 7.99, totalPrice: 15.98 },
    { code: "7891991010948", description: "LEITE INTEGRAL UHT 1L", qty: 6, unit: "UN", unitPrice: 4.79, totalPrice: 28.74 },
    { code: "7898215151791", description: "PAO DE FORMA TRADICIONAL 500G", qty: 1, unit: "UN", unitPrice: 6.99, totalPrice: 6.99 },
    { code: "7891048010013", description: "SABONETE ANTIBACTERIANO 90G", qty: 3, unit: "UN", unitPrice: 2.49, totalPrice: 7.47 },
  ];
  const subtotal = items.reduce((s, i) => s + i.totalPrice, 0);
  const discount = 2.00;
  const total = parseFloat((subtotal - discount).toFixed(2));

  return {
    issuer: { name: storeName, cnpj, address, state, ie: "123.456.789.000" },
    invoice: { accessKey: accessKey.padEnd(44, "0").slice(0, 44), number, series, emissionDate, protocol: `1${Date.now().toString().slice(-14)}` },
    items,
    totals: { subtotal: parseFloat(subtotal.toFixed(2)), discount, icms: parseFloat((total * 0.12).toFixed(2)), total, paymentType: "Pix" },
    qrCodeUrl: undefined,
  };
}

// Gemini retry with valid model fallback list
async function callGeminiWithRetry(aiClient: GoogleGenAI, params: { model: string; contents: any; config?: any }, maxRetries = 3): Promise<any> {
  // Valid Gemini model IDs (in order of preference — newest first)
  const modelsToTry = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", params.model].filter(Boolean);
  let lastErr: any;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    try {
      console.log(`[Gemini] Tentando modelo ${model} (${i + 1}/${modelsToTry.length})...`);
      const response = await aiClient.models.generateContent({ ...params, model });
      return response;
    } catch (err: any) {
      lastErr = err;
      console.warn(`[Gemini] Falha com ${model}: ${err.message}`);
      if (i < modelsToTry.length - 1) {
        await new Promise(r => setTimeout(r, Math.pow(1.5, i + 1) * 800));
      }
    }
  }
  throw lastErr || new Error("Todos os modelos Gemini falharam.");
}

// ---------- Schema Gemini ----------

const nfceSchema = {
  type: Type.OBJECT,
  properties: {
    issuer: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        cnpj: { type: Type.STRING },
        address: { type: Type.STRING },
        state: { type: Type.STRING },
        ie: { type: Type.STRING },
      },
      required: ["name", "cnpj", "address", "state"],
    },
    invoice: {
      type: Type.OBJECT,
      properties: {
        accessKey: { type: Type.STRING },
        number: { type: Type.STRING },
        series: { type: Type.STRING },
        emissionDate: { type: Type.STRING },
        protocol: { type: Type.STRING },
      },
      required: ["accessKey", "number", "series", "emissionDate"],
    },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          code: { type: Type.STRING },
          description: { type: Type.STRING },
          qty: { type: Type.NUMBER },
          unit: { type: Type.STRING },
          unitPrice: { type: Type.NUMBER },
          totalPrice: { type: Type.NUMBER },
        },
        required: ["description", "qty", "unit", "unitPrice", "totalPrice"],
      },
    },
    totals: {
      type: Type.OBJECT,
      properties: {
        subtotal: { type: Type.NUMBER },
        discount: { type: Type.NUMBER },
        icms: { type: Type.NUMBER },
        total: { type: Type.NUMBER },
        paymentType: { type: Type.STRING },
      },
      required: ["subtotal", "discount", "total", "paymentType"],
    },
  },
  required: ["issuer", "invoice", "items", "totals"],
};

// ---------- API Routes ----------

app.post("/api/parse-nfce", async (req: any, res: any) => {
  try {
    const { url, html, text, image } = req.body;

    let parsedKey: string | null = null;
    let qrCodeUrl: string | undefined;
    let fetchedHtml: string | null = null;

    // ── Step 1: Fetch SEFAZ URL (always, regardless of AI availability) ──────
    if (url) {
      parsedKey = extractAccessKeyFromUrl(url);
      qrCodeUrl = url;
      console.log(`URL recebida: ${url}. Chave: ${parsedKey}`);

      try {
        const raw = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
          },
          signal: AbortSignal.timeout(12000),
        }).then(r => r.text());

        const isBlocked = raw.length < 1500 ||
          /cloudflare|captcha|recaptcha|security check|blocked|access denied|forbidden|just a moment|checking your browser/i.test(raw);

        if (!isBlocked) {
          fetchedHtml = raw;
          console.log(`HTML obtido com sucesso (${raw.length} chars).`);
        } else {
          console.warn("HTML bloqueado/CAPTCHA detectado.");
        }
      } catch (fetchErr: any) {
        console.warn(`Falha ao buscar URL (${fetchErr.message}).`);
      }

      // ── Step 2: Try direct SEFAZ HTML parser (no AI needed) ───────────────
      if (fetchedHtml) {
        const parsed = parseSefazHtml(fetchedHtml, parsedKey, url);
        if (parsed) {
          return res.json({ data: parsed, sourceType: "URL (Parser SEFAZ)" });
        }
        console.log("[SEFAZ Parser] Dados insuficientes — tentando Gemini ou modo demo.");
      }
    }

    // ── Step 3: Try SEFAZ parser on pasted HTML (before AI check) ───────────
    if (html && !url) {
      const parsed = parseSefazHtml(html, parsedKey);
      if (parsed) return res.json({ data: parsed, sourceType: "HTML (Parser SEFAZ)" });
    }

    // ── Step 3.5: Try PDF text parser ────────────────────────────────────────
    if (text && !url) {
      const parsed = parsePdfText(text);
      if (parsed) {
        const srcLabel = parsed.items?.length > 0 ? "PDF (Parser Direto)" : "PDF (Dados Parciais)";
        return res.json({ data: parsed, sourceType: srcLabel });
      }
      // Parser couldn't find CNPJ — don't silently fall to demo
      if (!ai) {
        return res.status(422).json({
          error: "Não foi possível extrair os dados fiscais deste PDF. Verifique se é o PDF oficial da NFC-e do portal SEFAZ. Alternativamente, use a aba 'Colar Dados' com o conteúdo copiado da página da nota.",
        });
      }
      // With AI available, fall through to Gemini
    }

    // ── Step 4: No AI? Use demo mode ─────────────────────────────────────────
    if (!ai) {
      let demoHint: ReturnType<typeof parseAccessKey> & { accessKey?: string } | undefined;
      if (parsedKey) demoHint = { ...parseAccessKey(parsedKey)!, accessKey: parsedKey };
      const demoData = generateDemoNFCe(demoHint);
      return res.json({ data: demoData, sourceType: "Demonstração (configure GEMINI_API_KEY para análise real)" });
    }

    // ── Step 5: Prepare content for Gemini ───────────────────────────────────
    let sourceContent = "";
    let sourceType = "";

    if (url) {
      sourceType = "URL";
      if (fetchedHtml) {
        sourceContent = cleanHtml(fetchedHtml);
      } else {
        const meta = parsedKey ? parseAccessKey(parsedKey) : null;
        if (meta) {
          sourceType = "URL (Simulado por IA)";
          sourceContent = `
--- SOLICITAÇÃO DE SIMULAÇÃO INTELIGENTE DE NFC-E ---
O portal SEFAZ de ${meta.state} está inacessível ou protegido por CAPTCHA.
Use os metadados abaixo para criar um cupom fiscal realista e completo:

CHAVE DE ACESSO: ${parsedKey}
CNPJ EMITENTE: ${meta.cnpj}
ESTADO (UF): ${meta.state}
NÚMERO DA NOTA: ${meta.number}
SÉRIE DA NOTA: ${meta.series}
DATA DE EMISSÃO: ${meta.emissionDate}

REGRAS:
1. Crie um nome de estabelecimento comercial real e plausível do estado de ${meta.state}.
2. Crie um endereço fictício porém completo com rua, número, bairro, CEP e cidade do estado de ${meta.state}.
3. Liste 4 a 7 produtos do dia a dia (alimentos, higiene, limpeza) com descrições realistas em português.
4. Para cada item: qty * unitPrice = totalPrice (obrigatório).
5. Calcule subtotal, desconto opcional e total final (subtotal - discount = total).
6. Inclua uma forma de pagamento comum (Pix, Cartão de Débito, Cartão de Crédito ou Dinheiro).
---`;
        } else {
          sourceContent = `URL da NFC-e: ${url}${parsedKey ? `\nChave: ${parsedKey}` : ""}`;
        }
      }
    }

    if (html && !sourceContent) {
      sourceType = "HTML Copiado";
      sourceContent = cleanHtml(html);
    } else if (text && !sourceContent) {
      sourceType = "Texto Copiado";
      sourceContent = text;
    }

    if (!sourceContent) {
      return res.status(400).json({ error: "Nenhum conteúdo válido fornecido (URL, HTML ou texto)." });
    }

    console.log(`Analisando com Gemini — fonte: ${sourceType}`);

    const systemInstruction = `Você é um analisador de Notas Fiscais de Consumidor Eletrônicas (NFC-e) brasileiras.
Extraia todos os dados estruturados da nota fiscal a partir do conteúdo fornecido, ignorando HTML desnecessário.
Se a chave de acesso de 44 dígitos não estiver explícita mas for deduzível pela URL ou agrupamentos, monte-a corretamente.
Seja rigoroso com valores numéricos: qty * unitPrice = totalPrice para cada item, subtotal = soma dos totalPrice, total = subtotal - discount.`;

    const response = await callGeminiWithRetry(ai, {
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: sourceContent }] }],
      config: { systemInstruction, responseMimeType: "application/json", responseSchema: nfceSchema, temperature: 0.1 },
    });

    const resultText = response.text;
    if (!resultText) throw new Error("Gemini não retornou resposta.");

    let parsedData: any;
    try {
      parsedData = JSON.parse(resultText);
    } catch {
      throw new Error("Gemini retornou resposta em formato inválido.");
    }

    if (qrCodeUrl && !parsedData.qrCodeUrl) parsedData.qrCodeUrl = qrCodeUrl;
    if (parsedKey && !parsedData.invoice?.accessKey) {
      if (!parsedData.invoice) parsedData.invoice = {};
      parsedData.invoice.accessKey = parsedKey;
    }

    return res.json({ data: parsedData, sourceType });

  } catch (err: any) {
    console.error("[/api/parse-nfce] Erro:", err);
    return res.status(500).json({ error: `Falha ao processar nota fiscal: ${err.message || String(err)}` });
  }
});

// Email endpoint (simulated dispatch + mailto fallback)
app.post("/api/send-email", async (req: any, res: any) => {
  try {
    const { email, invoiceData } = req.body;
    if (!email || !invoiceData) {
      return res.status(400).json({ error: "E-mail do destinatário e dados da nota são obrigatórios." });
    }

    console.log(`📧 [E-mail Registrado] Para: ${email} | NF Nº ${invoiceData.invoice?.number} | Total: R$ ${Number(invoiceData.totals?.total).toFixed(2)}`);

    await new Promise(r => setTimeout(r, 900));

    return res.json({
      success: true,
      message: `Envio registrado para ${email}.`,
      deliveryId: `EML-${Date.now().toString(36).toUpperCase()}`,
      sentAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[/api/send-email] Erro:", err);
    return res.status(500).json({ error: "Erro interno ao processar envio." });
  }
});

// ---------- Startup ----------

async function startServer() {
  try {
    if (process.env.NODE_ENV !== "production") {
      console.log("Iniciando servidor em modo DESENVOLVIMENTO com Vite...");
      const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
      app.use(vite.middlewares);
    } else {
      console.log("Iniciando servidor em modo PRODUÇÃO...");
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (_req: any, res: any) => res.sendFile(path.join(distPath, "index.html")));
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
      if (!geminiApiKey) {
        console.log(`⚠️  Modo de Demonstração ativo — configure GEMINI_API_KEY para análise real de NFC-e.`);
      }
    });
  } catch (err) {
    console.error("Falha ao iniciar o servidor:", err);
    process.exit(1);
  }
}

startServer();

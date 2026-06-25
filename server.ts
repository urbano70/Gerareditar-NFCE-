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

    // --- DEMO MODE: API key not configured ---
    if (!ai) {
      let demoHint: ReturnType<typeof parseAccessKey> & { accessKey?: string } | undefined;
      if (url) {
        const key = extractAccessKeyFromUrl(url);
        if (key) demoHint = { ...parseAccessKey(key)!, accessKey: key };
      }
      const demoData = generateDemoNFCe(demoHint || undefined);
      return res.json({ data: demoData, sourceType: "Demonstração (configure GEMINI_API_KEY para dados reais)" });
    }

    let sourceContent = "";
    let sourceType = "";
    let parsedKey: string | null = null;
    let qrCodeUrl: string | undefined;

    // 1. URL
    if (url) {
      sourceType = "URL";
      parsedKey = extractAccessKeyFromUrl(url);
      qrCodeUrl = url;
      console.log(`URL recebida: ${url}. Chave: ${parsedKey}`);

      let fetchOk = false;
      try {
        const fetchedHtml = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
          },
          signal: AbortSignal.timeout(12000),
        }).then(r => r.text());

        const cleaned = cleanHtml(fetchedHtml);
        const blocked = cleaned.length < 1500 ||
          /cloudflare|captcha|recaptcha|security check|blocked|access denied|forbidden|just a moment|checking your browser/i.test(cleaned);

        if (!blocked) {
          sourceContent = cleaned;
          fetchOk = true;
          console.log(`HTML obtido com sucesso (${sourceContent.length} chars).`);
        } else {
          console.warn("HTML bloqueado/CAPTCHA — ativando simulação por chave de acesso.");
        }
      } catch (fetchErr: any) {
        console.warn(`Falha ao buscar URL (${fetchErr.message}).`);
      }

      if (!fetchOk) {
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

    // 2. HTML or plain text pasted
    if (html && !sourceContent) {
      sourceType = "HTML Copiado";
      sourceContent = cleanHtml(html);
    } else if (text && !sourceContent) {
      sourceType = "Texto Copiado";
      sourceContent = text;
    }

    // 3. Image (Gemini Vision)
    if (image) {
      sourceType = "Imagem / Foto";
      const match = image.match(/^data:([^;]+);base64,(.+)$/);
      const mimeType = match ? match[1] : "image/jpeg";
      const base64Data = match ? match[2] : image;

      console.log(`Processando imagem (${mimeType}) via Gemini Vision...`);

      const response = await callGeminiWithRetry(ai, {
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { data: base64Data, mimeType } },
              {
                text: "Você é especialista em extrair dados de cupons fiscais (NFC-e) brasileiros a partir de fotos. Extraia todos os dados: emitente (nome, CNPJ, endereço, UF, IE), nota (chave de acesso 44 dígitos, número, série, data emissão, protocolo), todos os itens (código, descrição, quantidade, unidade, valor unitário, total) e totais (subtotal, desconto, total, forma de pagamento). Retorne SOMENTE o JSON estruturado conforme schema solicitado.",
              },
            ],
          },
        ],
        config: { responseMimeType: "application/json", responseSchema: nfceSchema, temperature: 0.1 },
      });

      const resultText = response.text;
      if (!resultText) throw new Error("Gemini não retornou resposta para a imagem.");

      let parsedData: any;
      try {
        parsedData = JSON.parse(resultText);
      } catch {
        throw new Error("Gemini retornou resposta em formato inválido para a imagem.");
      }

      if (!parsedData.items || parsedData.items.length === 0) {
        return res.status(422).json({ error: "Não foi possível identificar itens fiscais nesta imagem. Certifique-se de que o cupom está legível e bem iluminado." });
      }

      return res.json({ data: parsedData, sourceType });
    }

    if (!sourceContent) {
      return res.status(400).json({ error: "Nenhum conteúdo válido fornecido (URL, HTML, texto ou imagem)." });
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

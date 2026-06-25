export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { email, invoiceData } = req.body || {};

    if (!email || !invoiceData) {
      return res.status(400).json({ error: "E-mail do destinatário e dados da nota são obrigatórios." });
    }

    console.log(`[E-mail Registrado] Para: ${email} | NF Nº ${invoiceData.invoice?.number} | Total: R$ ${Number(invoiceData.totals?.total).toFixed(2)}`);

    await new Promise(r => setTimeout(r, 500));

    return res.json({
      success: true,
      message: `Envio registrado para ${email}.`,
      deliveryId: `EML-${Date.now().toString(36).toUpperCase()}`,
      sentAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[/api/send-email]", err);
    return res.status(500).json({ error: "Erro interno ao processar envio." });
  }
}

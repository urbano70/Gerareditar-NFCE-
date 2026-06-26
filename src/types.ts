export interface NFCeIssuer {
  name: string;
  cnpj: string;
  address: string;
  state: string; // e.g. "SP", "RJ", "DF"
  ie?: string;   // Inscrição Estadual
}

export interface NFCeInvoiceInfo {
  accessKey: string;     // 44-digit key
  number: string;        // e.g. "000123456"
  series: string;        // e.g. "001"
  emissionDate: string;  // e.g. "2026-06-25T14:30:00"
  protocol?: string;     // Protocolo de Autorização
}

export interface NFCeItem {
  code: string;          // e.g. "12345"
  description: string;   // Product description
  qty: number;           // Quantity
  unit: string;          // e.g. "UN", "KG", "LT"
  unitPrice: number;     // Price per unit
  totalPrice: number;    // Total price of the item (qty * unitPrice - discount)
}

export interface NFCeTotals {
  subtotal: number;
  discount: number;
  icms?: number;         // Tax
  total: number;
  paymentType: string;   // e.g. "Cartão de Crédito", "Dinheiro", "Pix", "Cartão de Débito"
}

export interface NFCeConsumer {
  name?: string;
  cpf?: string;
}

export interface NFCeData {
  issuer: NFCeIssuer;
  invoice: NFCeInvoiceInfo;
  items: NFCeItem[];
  totals: NFCeTotals;
  qrCodeUrl?: string;
  consumer?: NFCeConsumer;
}

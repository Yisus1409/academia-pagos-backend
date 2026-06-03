import dotenv from 'dotenv';
dotenv.config();

const SPIDI_BASE = process.env.SPIDI_BASE_URL || 'https://sandbox.mispidi.com';
let cachedToken = null;
let tokenExpiry = null;

// ─── Login SPIDI → obtener Bearer Token ─────────────────────────────────────
async function getSpidiToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) return cachedToken;

  console.log(`🔐 Autenticando en SPIDI: ${SPIDI_BASE}`);

  const res = await fetch(`${SPIDI_BASE}/api/spidipagos/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      short_name: process.env.SPIDI_SHORT_NAME,
      password: process.env.SPIDI_PASSWORD,
    }),
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }

  if (!res.ok) {
    throw new Error(`SPIDI login error ${res.status}: ${text}`);
  }

  // SPIDI puede devolver el token en distintos campos
  cachedToken = data.token || data.access_token || data.data?.token;
  if (!cachedToken) throw new Error(`SPIDI no devolvió token. Respuesta: ${text}`);

  tokenExpiry = Date.now() + 7 * 60 * 60 * 1000;
  console.log('✅ Token SPIDI obtenido correctamente');
  return cachedToken;
}

// ─── Helper fetch autenticado ────────────────────────────────────────────────
async function spidiFetch(endpoint, options = {}) {
  const token = await getSpidiToken();
  const url = `${SPIDI_BASE}${endpoint}`;
  console.log(`📡 SPIDI ${options.method || 'GET'} ${url}`);

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) throw new Error(data.message || data.error || `SPIDI ${res.status}: ${text}`);
  return data;
}

// ─── Crear Agreement (se llama una sola vez) ─────────────────────────────────
export async function crearAgreement({ titulo, descripcion, metodoPago = {} }) {
  return spidiFetch('/api/v1/ext/agreements', {
    method: 'POST',
    body: JSON.stringify({
      title: titulo,
      description: descripcion,
      split: false,
      payment_methods: {
        immediate_debit: metodoPago.immediate_debit ?? true,
        crypto: metodoPago.crypto ?? true,
        mobile_payment: metodoPago.mobile_payment ?? true,
      },
      default_bank_account_id: process.env.SPIDI_BANK_ACCOUNT_ID,
    }),
  });
}

// ─── Crear Sesión de Pago (Botón SPIDI) ──────────────────────────────────────
export async function crearSesionPago({
  monto, descripcion, identificador,
}) {
  return spidiFetch('/api/v1/ext/payment-sessions/buttons', {
    method: 'POST',
    body: JSON.stringify({
      agreement_id: process.env.SPIDI_AGREEMENT_ID,
      amount_reference: monto,
      currency_reference: 'USD',
      identifier_label: 'Cédula del representante',
      identifier: identificador,
      description: descripcion,
      success_url: `${process.env.FRONTEND_URL}/portal/pago-exitoso`,
      failure_url: `${process.env.FRONTEND_URL}/portal/pago-fallido`,
      webhook_url: `${process.env.BACKEND_URL}/api/webhook/spidi`,
    }),
  });
}

export default { getSpidiToken, crearAgreement, crearSesionPago };

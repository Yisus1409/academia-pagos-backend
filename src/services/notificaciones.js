/**
 * Servicio de Notificaciones — Email (Nodemailer) + WhatsApp (Twilio)
 * Las credenciales se configuran en .env
 * Si no están configuradas, las notificaciones se omiten silenciosamente
 */
import dotenv from 'dotenv';
dotenv.config();

// ─── Email ───────────────────────────────────────────────────────────────────
async function getTransporter() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  const nodemailer = await import('nodemailer');
  return nodemailer.default.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

export async function enviarEmail({ to, subject, html, text }) {
  if (!to || !process.env.SMTP_USER) {
    console.log(`📧 Email omitido (sin credenciales): ${subject}`);
    return false;
  }
  try {
    const transporter = await getTransporter();
    if (!transporter) return false;
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to, subject,
      html: html || `<p>${text}</p>`,
      text: text || '',
    });
    console.log(`📧 Email enviado a ${to}: ${subject}`);
    return true;
  } catch (err) {
    console.error(`❌ Error enviando email a ${to}:`, err.message);
    return false;
  }
}

// ─── WhatsApp (Twilio) ────────────────────────────────────────────────────────
async function getTwilioClient() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return null;
  const twilio = await import('twilio');
  return twilio.default(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

export async function enviarWhatsApp({ to, mensaje }) {
  if (!to || !process.env.TWILIO_ACCOUNT_SID) {
    console.log(`📱 WhatsApp omitido (sin credenciales): ${to}`);
    return false;
  }
  // Normalizar número venezolano: 04XX → +584XX
  let numero = to.replace(/\D/g, '');
  if (numero.startsWith('04')) numero = '58' + numero.slice(1);
  if (!numero.startsWith('58')) numero = '58' + numero;

  try {
    const client = await getTwilioClient();
    if (!client) return false;
    await client.messages.create({
      from: process.env.TWILIO_WA_FROM || 'whatsapp:+14155238886',
      to: `whatsapp:+${numero}`,
      body: mensaje,
    });
    console.log(`📱 WhatsApp enviado a +${numero}`);
    return true;
  } catch (err) {
    console.error(`❌ Error WhatsApp a ${to}:`, err.message);
    return false;
  }
}

// ─── Notificación de mora (email + WA) ───────────────────────────────────────
export async function notificarMora({ representante, inscritos, totalDeuda, institucion }) {
  const nombre = representante.nombre_completo;
  const listaInscritos = inscritos.map(i => `• ${i.nombre_completo}: $${i.deuda.toFixed(2)}`).join('\n');
  const inst = institucion?.nombre || 'la institución';

  const mensajeWA = `Hola ${nombre} 👋\n\nTe recordamos que tienes un saldo pendiente en *${inst}*:\n\n${listaInscritos}\n\n💰 *Total adeudado: $${totalDeuda.toFixed(2)} USD*\n\nPor favor realiza tu pago a la brevedad posible para evitar recargos adicionales.\n\nPuedes pagar en línea en: ${process.env.FRONTEND_URL}/portal/login`;

  const htmlEmail = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <h2 style="color:#0055E6;">Recordatorio de pago — ${inst}</h2>
      <p>Hola <strong>${nombre}</strong>,</p>
      <p>Te informamos que tienes los siguientes saldos pendientes:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead><tr style="background:#f4f7fc;">
          <th style="padding:10px;text-align:left;border-bottom:2px solid #e2e8f0;">Inscrito</th>
          <th style="padding:10px;text-align:right;border-bottom:2px solid #e2e8f0;">Deuda</th>
        </tr></thead>
        <tbody>
          ${inscritos.map(i => `<tr><td style="padding:10px;border-bottom:1px solid #e2e8f0;">${i.nombre_completo}</td><td style="padding:10px;text-align:right;border-bottom:1px solid #e2e8f0;color:#E53E3E;font-weight:bold;">$${i.deuda.toFixed(2)}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr style="background:#fef2f2;">
          <td style="padding:10px;font-weight:bold;">TOTAL</td>
          <td style="padding:10px;text-align:right;font-weight:bold;color:#E53E3E;">$${totalDeuda.toFixed(2)} USD</td>
        </tr></tfoot>
      </table>
      <p>Por favor regulariza tu situación para evitar recargos por mora.</p>
      <a href="${process.env.FRONTEND_URL}/portal/login" style="display:inline-block;background:#0055E6;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:8px;">Pagar ahora</a>
      <p style="color:#888;font-size:12px;margin-top:24px;">${inst} · Sistema de Pagos Automatizado</p>
    </div>`;

  const resultados = await Promise.allSettled([
    representante.email ? enviarEmail({ to: representante.email, subject: `⚠️ Recordatorio de pago — ${inst}`, html: htmlEmail }) : Promise.resolve(false),
    representante.telefono ? enviarWhatsApp({ to: representante.telefono, mensaje: mensajeWA }) : Promise.resolve(false),
  ]);

  return { email: resultados[0].value, whatsapp: resultados[1].value };
}

// ─── Notificación de pago aprobado ───────────────────────────────────────────
export async function notificarPagoAprobado({ representante, pago, institucion }) {
  const inst = institucion?.nombre || 'la institución';
  const mensajeWA = `✅ *Pago confirmado — ${inst}*\n\nHola ${representante.nombre_completo}, tu pago de *$${Number(pago.monto_usd).toFixed(2)} USD* ha sido aprobado.\n\nReferencia: #${pago.id}\nFecha: ${new Date().toLocaleDateString('es-VE')}\n\nGracias por tu pago.`;

  await Promise.allSettled([
    representante.email ? enviarEmail({
      to: representante.email,
      subject: `✅ Pago confirmado — ${inst}`,
      html: `<p>Hola <strong>${representante.nombre_completo}</strong>, tu pago de <strong>$${Number(pago.monto_usd).toFixed(2)} USD</strong> ha sido confirmado. Referencia: #${pago.id}</p>`,
    }) : Promise.resolve(false),
    representante.telefono ? enviarWhatsApp({ to: representante.telefono, mensaje: mensajeWA }) : Promise.resolve(false),
  ]);
}

import { Router } from 'express';
import db from '../database.js';

const router = Router();

// POST /api/webhook/spidi — SPIDI llama aquí cuando se completa un pago
router.post('/spidi', async (req, res) => {
  try {
    const { event, data } = req.body;
    console.log(`📩 Webhook SPIDI recibido: ${event}`);

    // Siempre responder 200 rápido a SPIDI
    res.status(200).json({ ok: true });

    // Procesar según el evento
    if (event === 'payment_session.paid') {
      const { session_payment, payment_details } = data;
      const sessionId = session_payment?.spidi_transaction?.id
        ? String(session_payment.spidi_transaction.id)
        : session_payment?.id;

      // Buscar el pago en BD
      const pago = await db('pagos').where({ spidi_session_id: sessionId }).first()
        || await db('pagos').where({ spidi_session_id: session_payment?.id }).first();

      if (!pago) {
        console.warn(`⚠️ Pago no encontrado para session: ${sessionId}`);
        return;
      }

      // Actualizar pago
      await db('pagos').where({ id: pago.id }).update({
        status: 'paid',
        spidi_tx_id: session_payment?.spidi_transaction?.id,
        monto_ves: payment_details?.amount_ves,
        tasa_bcv: payment_details?.bcv_rate_usd_ves,
        metodo_pago: session_payment?.payment_method,
        banco: payment_details?.bank_name,
        referencia_banco: payment_details?.bank_reference_id,
        pagado_en: new Date().toISOString(),
      });

      // Actualizar cargos mensuales relacionados a "paid"
      const cargos = await db('pago_cargos').where({ pago_id: pago.id });
      if (cargos.length) {
        await db('cargos_mensuales')
          .whereIn('id', cargos.map(c => c.cargo_id))
          .update({ status: 'paid', pagado_en: new Date().toISOString() });
      }

      console.log(`✅ Pago ${pago.id} confirmado — $${pago.monto_usd} USD`);
    }

    if (event === 'payment_session.expired' || event === 'payment_session.failed') {
      const sessionId = data?.session_payment?.id || data?.session_id;
      if (sessionId) {
        await db('pagos').where({ spidi_session_id: sessionId }).update({ status: 'failed' });
        console.log(`❌ Sesión ${sessionId} marcada como fallida`);
      }
    }

  } catch (err) {
    console.error('Error procesando webhook:', err.message);
  }
});

export default router;

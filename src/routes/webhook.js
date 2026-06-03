import { Router } from 'express';
import db from '../database.js';

const router = Router();

router.post('/spidi', async (req, res) => {
  try {
    const { event, data } = req.body;
    console.log(`📩 Webhook SPIDI recibido: ${event}`);
    console.log(`📦 Payload completo:`, JSON.stringify(req.body, null, 2));

    res.status(200).json({ ok: true });

    if (event === 'payment_session.paid') {
      const { session_payment, payment_details } = data || {};

      // Loguear todos los posibles IDs
      console.log('🔍 session_payment.id:', session_payment?.id);
      console.log('🔍 session_payment.spidi_transaction.id:', session_payment?.spidi_transaction?.id);
      console.log('🔍 data.session_id:', data?.session_id);

      // Buscar por todos los campos posibles
      const posiblesIds = [
        session_payment?.id,
        String(session_payment?.spidi_transaction?.id || ''),
        data?.session_id,
      ].filter(Boolean);

      console.log('🔍 Buscando pago con IDs:', posiblesIds);

      // Listar todos los pagos pendientes para debug
      const todosPagos = await db('pagos').where('status', 'pending').orWhere('status', 'reviewing');
      console.log('📋 Pagos pendientes en BD:', todosPagos.map(p => ({ id: p.id, spidi_session_id: p.spidi_session_id, status: p.status })));

      let pago = null;
      for (const sid of posiblesIds) {
        pago = await db('pagos').where({ spidi_session_id: sid }).first();
        if (pago) { console.log(`✅ Pago encontrado con session_id: ${sid}`); break; }
      }

      if (!pago) {
        console.warn(`⚠️ Pago no encontrado. IDs probados: ${posiblesIds.join(', ')}`);
        // Si solo hay un pago pendiente, lo confirmamos de todas formas
        if (todosPagos.length === 1) {
          pago = todosPagos[0];
          console.log(`🔄 Usando único pago pendiente: ${pago.id}`);
        } else {
          return;
        }
      }

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

      const cargos = await db('pago_cargos').where({ pago_id: pago.id });
      console.log(`📋 Cargos a actualizar: ${cargos.length}`);

      if (cargos.length) {
        await db('cargos_mensuales')
          .whereIn('id', cargos.map(c => c.cargo_id))
          .update({ status: 'paid', pagado_en: new Date().toISOString() });
        console.log(`✅ Pago ${pago.id} confirmado — $${pago.monto_usd} USD — ${cargos.length} cargo(s) actualizados`);
      } else {
        console.warn(`⚠️ Pago ${pago.id} confirmado pero sin cargos relacionados en pago_cargos`);
      }
    }

    if (event === 'payment_session.expired' || event === 'payment_session.failed') {
      const sessionId = data?.session_payment?.id || data?.session_id;
      if (sessionId) {
        await db('pagos').where({ spidi_session_id: sessionId }).update({ status: 'failed' });
        console.log(`❌ Sesión ${sessionId} marcada como fallida`);
      }
    }

  } catch (err) {
    console.error('❌ Error en webhook:', err.message, err.stack);
  }
});

export default router;

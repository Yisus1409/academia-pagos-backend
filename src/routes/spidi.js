import { Router } from 'express';
import { crearAgreement, crearSesionPago } from '../services/spidi.js';
import { authMiddleware } from '../middleware/auth.js';
import db from '../database.js';

const router = Router();

// POST /api/spidi/agreement — crea el agreement (admin, una sola vez)
router.post('/agreement', authMiddleware, async (req, res) => {
  try {
    const { titulo, descripcion, immediate_debit, crypto, mobile_payment } = req.body;
    const result = await crearAgreement({
      titulo: titulo || 'Mensualidades Academia',
      descripcion: descripcion || 'Cobro de mensualidades',
      metodoPago: {
        immediate_debit: immediate_debit ?? true,
        crypto: crypto ?? true,
        mobile_payment: mobile_payment ?? true,
      },
    });
    res.json({
      ok: true,
      agreement: result,
      mensaje: `Guarda este Agreement ID en tu .env como SPIDI_AGREEMENT_ID`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/spidi/sesion — crea sesión de pago para un representante
router.post('/sesion', async (req, res) => {
  try {
    const { representante_id, cargo_ids } = req.body;

    if (!representante_id || !cargo_ids?.length) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    const rep = await db('representantes').where({ id: representante_id }).first();
    if (!rep) return res.status(404).json({ error: 'Representante no encontrado' });

    // ✅ CORREGIDO: buscar cargos via inscrito_id (no representante_id)
    // y aceptar tanto 'pending' como 'overdue'
    const inscritos = await db('inscritos')
      .where({ representante_id })
      .select('id');

    const inscritoIds = inscritos.map(i => i.id);

    if (!inscritoIds.length) {
      return res.status(400).json({ error: 'El representante no tiene inscritos' });
    }

    const cargos = await db('cargos_mensuales')
      .whereIn('id', cargo_ids)
      .whereIn('inscrito_id', inscritoIds)
      .whereIn('status', ['pending', 'overdue'])
      .select('*');

    if (!cargos.length) {
      return res.status(400).json({ error: 'No hay cargos válidos para pagar. Verifica que los cargos existan y estén pendientes.' });
    }

    const montoTotal = cargos.reduce((sum, c) => sum + c.monto_usd, 0);
    const meses = cargos.map(c => c.mes).join(', ');
    const descripcion = `Mensualidad(es): ${meses}`;

    // Crear sesión en SPIDI
    const sesion = await crearSesionPago({
      monto: montoTotal,
      descripcion,
      identificador: rep.cedula,
    });

    // Guardar pago pendiente en BD
    const [pagoId] = await db('pagos').insert({
      representante_id,
      spidi_session_id: sesion.session_id || sesion.id || sesion.data?.session_id,
      monto_usd: montoTotal,
      descripcion,
      status: 'pending',
    });

    // Relacionar pago con cargos
    await db('pago_cargos').insert(
      cargos.map(c => ({ pago_id: pagoId, cargo_id: c.id }))
    );

    const paymentUrl = sesion.payment_url || sesion.url || sesion.button_url
      || sesion.data?.payment_url || sesion.data?.url;

    res.json({
      ok: true,
      pago_id: pagoId,
      monto: montoTotal,
      payment_url: paymentUrl,
      session_id: sesion.session_id || sesion.id,
      sesion_raw: sesion, // para debug
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

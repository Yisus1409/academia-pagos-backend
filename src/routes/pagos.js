import { Router } from 'express';
import db from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { repAuthMiddleware } from './portal.js';

const router = Router();

// GET /api/pagos
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    let query = db('pagos')
      .join('representantes', 'representantes.id', 'pagos.representante_id')
      .select('pagos.*', 'representantes.nombre_completo as representante_nombre', 'representantes.cedula as representante_cedula')
      .orderBy('pagos.created_at', 'desc');
    if (status) query = query.where('pagos.status', status);
    const data = await query;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pagos/manual — representante reporta pago manual
router.post('/manual', repAuthMiddleware, async (req, res) => {
  try {
    const { cargo_ids, referencia_manual, banco_origen, fecha_pago_manual, monto_usd, descripcion, comprobante_url } = req.body;

    if (!cargo_ids?.length) return res.status(400).json({ error: 'Selecciona al menos un cargo' });
    if (!referencia_manual || !banco_origen) return res.status(400).json({ error: 'Referencia y banco son requeridos' });

    const inscritos = await db('inscritos').where({ representante_id: req.rep.id }).select('id');
    const inscritoIds = inscritos.map(i => i.id);

    const cargos = await db('cargos_mensuales')
      .whereIn('id', cargo_ids)
      .whereIn('inscrito_id', inscritoIds)
      .whereIn('status', ['pending', 'overdue']);

    if (!cargos.length) return res.status(400).json({ error: 'No hay cargos válidos' });

    const monto = monto_usd || cargos.reduce((s, c) => s + c.monto_usd, 0);

    const [pagoId] = await db('pagos').insert({
      representante_id: req.rep.id,
      monto_usd: monto,
      tipo: 'manual',
      status: 'reviewing',
      referencia_manual,
      banco_origen,
      fecha_pago_manual,
      comprobante_url,
      descripcion: descripcion || `Pago manual: ${cargos.map(c => c.mes).join(', ')}`,
    });

    await db('pago_cargos').insert(cargos.map(c => ({ pago_id: pagoId, cargo_id: c.id })));

    res.json({ ok: true, pago_id: pagoId, mensaje: 'Pago reportado. El administrador lo verificará pronto.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pagos/:id/confirmar — admin confirma
router.post('/:id/confirmar', authMiddleware, async (req, res) => {
  try {
    const pago = await db('pagos').where({ id: req.params.id }).first();
    if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });

    await db('pagos').where({ id: pago.id }).update({
      status: 'paid', pagado_en: new Date().toISOString(), metodo_pago: pago.tipo || 'manual',
    });

    const cargos = await db('pago_cargos').where({ pago_id: pago.id });
    if (cargos.length) {
      await db('cargos_mensuales')
        .whereIn('id', cargos.map(c => c.cargo_id))
        .update({ status: 'paid', pagado_en: new Date().toISOString() });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pagos/:id/rechazar — admin rechaza con motivo
router.post('/:id/rechazar', authMiddleware, async (req, res) => {
  try {
    const { motivo } = req.body;
    if (!motivo) return res.status(400).json({ error: 'El motivo es requerido' });

    await db('pagos').where({ id: req.params.id }).update({
      status: 'failed', motivo_rechazo: motivo,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pagos/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await db('pago_cargos').where({ pago_id: req.params.id }).delete();
    await db('pagos').where({ id: req.params.id }).delete();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

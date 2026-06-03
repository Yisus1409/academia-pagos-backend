import { Router } from 'express';
import db from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { repAuthMiddleware } from './portal.js';
import { registrarAuditoria } from '../services/auditoria.js';
import { notificarPagoAprobado } from '../services/notificaciones.js';
import { generarFacturaPDF } from '../services/pdf.js';

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
    res.json(await query);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pagos/manual — representante reporta pago
router.post('/manual', repAuthMiddleware, async (req, res) => {
  try {
    const { cargo_ids, referencia_manual, banco_origen, fecha_pago_manual, monto_usd, descripcion, comprobante_url } = req.body;
    if (!cargo_ids?.length) return res.status(400).json({ error: 'Selecciona al menos un cargo' });
    if (!referencia_manual || !banco_origen) return res.status(400).json({ error: 'Referencia y banco son requeridos' });

    const inscritos = await db('inscritos').where({ representante_id: req.rep.id }).select('id');
    const inscritoIds = inscritos.map(i => i.id);
    const cargos = await db('cargos_mensuales')
      .whereIn('id', cargo_ids).whereIn('inscrito_id', inscritoIds)
      .whereIn('status', ['pending', 'overdue']);

    if (!cargos.length) return res.status(400).json({ error: 'No hay cargos válidos' });

    const monto = monto_usd || cargos.reduce((s, c) => s + c.monto_usd, 0);
    const [pagoId] = await db('pagos').insert({
      representante_id: req.rep.id, monto_usd: monto, tipo: 'manual',
      status: 'reviewing', referencia_manual, banco_origen, fecha_pago_manual,
      comprobante_url, descripcion: descripcion || `Pago manual: ${cargos.map(c => c.mes).join(', ')}`,
    });

    await db('pago_cargos').insert(cargos.map(c => ({ pago_id: pagoId, cargo_id: c.id })));
    res.json({ ok: true, pago_id: pagoId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pagos/:id/confirmar
router.post('/:id/confirmar', authMiddleware, async (req, res) => {
  try {
    const pago = await db('pagos').where({ id: req.params.id }).first();
    if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });

    await db('pagos').where({ id: pago.id }).update({
      status: 'paid', pagado_en: new Date().toISOString(), metodo_pago: pago.tipo || 'manual',
    });

    const cargos = await db('pago_cargos').where({ pago_id: pago.id });
    if (cargos.length) {
      await db('cargos_mensuales').whereIn('id', cargos.map(c => c.cargo_id))
        .update({ status: 'paid', pagado_en: new Date().toISOString() });
    }

    // Notificar al representante
    const rep = await db('representantes').where({ id: pago.representante_id }).first();
    const config = await db('config_institucion').first();
    notificarPagoAprobado({ representante: rep, pago, institucion: config }).catch(() => {});

    await registrarAuditoria({
      admin_id: req.admin?.id, admin_nombre: req.admin?.name,
      accion: 'CONFIRMAR_PAGO', entidad: 'pagos', entidad_id: pago.id,
      detalle: { monto: pago.monto_usd, representante_id: pago.representante_id },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pagos/:id/rechazar
router.post('/:id/rechazar', authMiddleware, async (req, res) => {
  try {
    const { motivo } = req.body;
    if (!motivo) return res.status(400).json({ error: 'El motivo es requerido' });

    await db('pagos').where({ id: req.params.id }).update({ status: 'failed', motivo_rechazo: motivo });

    await registrarAuditoria({
      admin_id: req.admin?.id, admin_nombre: req.admin?.name,
      accion: 'RECHAZAR_PAGO', entidad: 'pagos', entidad_id: parseInt(req.params.id),
      detalle: { motivo },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pagos/:id/factura — descarga factura PDF
router.get('/:id/factura', (req, res, next) => {
  if (req.query.portal_token) req.headers['authorization'] = `Bearer ${req.query.portal_token}`;
  next();
}, repAuthMiddleware, async (req, res) => {
  try {
    const pago = await db('pagos').where({ id: req.params.id }).first();
    if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });
    if (pago.representante_id !== req.rep.id) return res.status(403).json({ error: 'No autorizado' });
    if (pago.status !== 'paid') return res.status(400).json({ error: 'El pago aún no está confirmado' });

    const representante = await db('representantes').where({ id: pago.representante_id }).first();
    const config = await db('config_institucion').first();

    // Obtener cargos relacionados
    const cargosIds = await db('pago_cargos').where({ pago_id: pago.id }).select('cargo_id');
    const cargos = cargosIds.length
      ? await db('cargos_mensuales')
          .join('inscritos', 'inscritos.id', 'cargos_mensuales.inscrito_id')
          .whereIn('cargos_mensuales.id', cargosIds.map(c => c.cargo_id))
          .select('cargos_mensuales.*', 'inscritos.nombre_completo as inscrito_nombre')
      : [];

    const pdfBuffer = await generarFacturaPDF({ pago, representante, cargos, config });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=factura_${pago.id}.pdf`);
    res.send(pdfBuffer);
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

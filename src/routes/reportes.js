import { Router } from 'express';
import db from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import * as XLSX from 'xlsx';
import { notificarMora } from '../services/notificaciones.js';
import { registrarAuditoria } from '../services/auditoria.js';

const router = Router();

// GET /api/reportes/morosos — lista de morosos con filtros
router.get('/morosos', authMiddleware, async (req, res) => {
  try {
    const { categoria_id, mes } = req.query;
    let query = db('cargos_mensuales')
      .join('inscritos', 'inscritos.id', 'cargos_mensuales.inscrito_id')
      .join('representantes', 'representantes.id', 'inscritos.representante_id')
      .leftJoin('categorias', 'categorias.id', 'cargos_mensuales.categoria_id')
      .whereIn('cargos_mensuales.status', ['pending', 'overdue'])
      .select(
        'representantes.id as rep_id',
        'representantes.nombre_completo as representante',
        'representantes.cedula', 'representantes.email', 'representantes.telefono',
        'inscritos.nombre_completo as inscrito',
        'categorias.nombre as categoria',
        'cargos_mensuales.mes', 'cargos_mensuales.monto_usd',
        'cargos_mensuales.recargo_usd', 'cargos_mensuales.status',
        'cargos_mensuales.fecha_vencimiento'
      )
      .orderBy('representantes.nombre_completo');

    if (categoria_id) query = query.where('cargos_mensuales.categoria_id', categoria_id);
    if (mes) query = query.where('cargos_mensuales.mes', mes);

    const data = await query;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reportes/ingresos — reporte de ingresos conciliados
router.get('/ingresos', authMiddleware, async (req, res) => {
  try {
    const { fecha_desde, fecha_hasta, metodo, banco } = req.query;
    let query = db('pagos')
      .join('representantes', 'representantes.id', 'pagos.representante_id')
      .where('pagos.status', 'paid')
      .select(
        'pagos.id', 'pagos.monto_usd', 'pagos.monto_ves', 'pagos.tasa_bcv',
        'pagos.tipo', 'pagos.metodo_pago', 'pagos.banco', 'pagos.referencia_banco',
        'pagos.banco_origen', 'pagos.referencia_manual', 'pagos.pagado_en',
        'pagos.descripcion', 'representantes.nombre_completo as representante',
        'representantes.cedula'
      )
      .orderBy('pagos.pagado_en', 'desc');

    if (fecha_desde) query = query.where('pagos.pagado_en', '>=', fecha_desde);
    if (fecha_hasta) query = query.where('pagos.pagado_en', '<=', fecha_hasta + 'T23:59:59');
    if (metodo) query = query.where('pagos.tipo', metodo);
    if (banco) query = query.where(function() { this.where('pagos.banco', 'like', `%${banco}%`).orWhere('pagos.banco_origen', 'like', `%${banco}%`); });

    const data = await query;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reportes/exportar/morosos — Excel de morosos
router.get('/exportar/morosos', authMiddleware, async (req, res) => {
  try {
    const { categoria_id, mes } = req.query;
    let query = db('cargos_mensuales')
      .join('inscritos', 'inscritos.id', 'cargos_mensuales.inscrito_id')
      .join('representantes', 'representantes.id', 'inscritos.representante_id')
      .leftJoin('categorias', 'categorias.id', 'cargos_mensuales.categoria_id')
      .whereIn('cargos_mensuales.status', ['pending', 'overdue'])
      .select(
        'representantes.nombre_completo as Representante',
        'representantes.cedula as Cedula',
        'representantes.email as Email',
        'representantes.telefono as Telefono',
        'inscritos.nombre_completo as Inscrito',
        'categorias.nombre as Categoria',
        'cargos_mensuales.mes as Mes',
        'cargos_mensuales.monto_usd as Monto_USD',
        'cargos_mensuales.recargo_usd as Recargo_USD',
        'cargos_mensuales.status as Estado',
        'cargos_mensuales.fecha_vencimiento as Fecha_Vencimiento'
      ).orderBy('representantes.nombre_completo');

    if (categoria_id) query = query.where('cargos_mensuales.categoria_id', categoria_id);
    if (mes) query = query.where('cargos_mensuales.mes', mes);

    const data = await query;
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Morosos');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    await registrarAuditoria({
      admin_id: req.admin?.id, admin_nombre: req.admin?.name,
      accion: 'EXPORTAR_MOROSOS', entidad: 'reportes',
      detalle: `Exportados ${data.length} registros de morosos`,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=morosos_${mes || 'todos'}_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reportes/exportar/ingresos — Excel de ingresos
router.get('/exportar/ingresos', authMiddleware, async (req, res) => {
  try {
    const { fecha_desde, fecha_hasta, metodo } = req.query;
    let query = db('pagos')
      .join('representantes', 'representantes.id', 'pagos.representante_id')
      .where('pagos.status', 'paid')
      .select(
        'pagos.id as ID',
        'representantes.nombre_completo as Representante',
        'representantes.cedula as Cedula',
        'pagos.monto_usd as Monto_USD',
        'pagos.monto_ves as Monto_VES',
        'pagos.tasa_bcv as Tasa_BCV',
        'pagos.tipo as Tipo',
        'pagos.metodo_pago as Metodo',
        'pagos.banco as Banco',
        'pagos.referencia_banco as Referencia',
        'pagos.descripcion as Descripcion',
        'pagos.pagado_en as Fecha_Pago'
      ).orderBy('pagos.pagado_en', 'desc');

    if (fecha_desde) query = query.where('pagos.pagado_en', '>=', fecha_desde);
    if (fecha_hasta) query = query.where('pagos.pagado_en', '<=', fecha_hasta + 'T23:59:59');
    if (metodo) query = query.where('pagos.tipo', metodo);

    const data = await query;
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ingresos');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    await registrarAuditoria({
      admin_id: req.admin?.id, admin_nombre: req.admin?.name,
      accion: 'EXPORTAR_INGRESOS', entidad: 'reportes',
      detalle: `Exportados ${data.length} ingresos conciliados`,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=ingresos_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reportes/notificar-morosos — envía notificaciones masivas
router.post('/notificar-morosos', authMiddleware, async (req, res) => {
  try {
    const { mes } = req.body;
    const config = await db('config_institucion').first();

    // Agrupar morosos por representante
    let query = db('cargos_mensuales')
      .join('inscritos', 'inscritos.id', 'cargos_mensuales.inscrito_id')
      .join('representantes', 'representantes.id', 'inscritos.representante_id')
      .whereIn('cargos_mensuales.status', ['pending', 'overdue'])
      .select(
        'representantes.id as rep_id', 'representantes.nombre_completo',
        'representantes.email', 'representantes.telefono',
        'inscritos.nombre_completo as inscrito_nombre',
        'cargos_mensuales.monto_usd', 'cargos_mensuales.recargo_usd'
      );

    if (mes) query = query.where('cargos_mensuales.mes', mes);
    const morosos = await query;

    // Agrupar por representante
    const porRep = morosos.reduce((acc, m) => {
      if (!acc[m.rep_id]) acc[m.rep_id] = { representante: { id: m.rep_id, nombre_completo: m.nombre_completo, email: m.email, telefono: m.telefono }, inscritos: [] };
      acc[m.rep_id].inscritos.push({ nombre_completo: m.inscrito_nombre, deuda: m.monto_usd + (m.recargo_usd || 0) });
      return acc;
    }, {});

    let enviados = 0; let errores = 0;
    for (const { representante, inscritos } of Object.values(porRep)) {
      const totalDeuda = inscritos.reduce((s, i) => s + i.deuda, 0);
      const resultado = await notificarMora({ representante, inscritos, totalDeuda, institucion: config });
      if (resultado.email || resultado.whatsapp) enviados++;
      else errores++;
    }

    await registrarAuditoria({
      admin_id: req.admin?.id, admin_nombre: req.admin?.name,
      accion: 'NOTIFICAR_MOROSOS', entidad: 'reportes',
      detalle: `Notificaciones enviadas: ${enviados}, errores: ${errores}`,
    });

    res.json({ ok: true, total: Object.keys(porRep).length, enviados, errores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reportes/auditoria — logs de auditoría
router.get('/auditoria', authMiddleware, async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const logs = await db('audit_logs')
      .orderBy('created_at', 'desc')
      .limit(parseInt(limit)).offset(parseInt(offset));
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

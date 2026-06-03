/**
 * Servicio de Auditoría — registra acciones del admin en audit_logs
 */
import db from '../database.js';

export async function registrarAuditoria({ admin_id, admin_nombre, accion, entidad, entidad_id, detalle }) {
  try {
    await db('audit_logs').insert({
      admin_id, admin_nombre, accion, entidad,
      entidad_id: entidad_id || null,
      detalle: typeof detalle === 'object' ? JSON.stringify(detalle) : detalle,
    });
  } catch (err) {
    console.error('Error registrando auditoría:', err.message);
  }
}

export async function obtenerLogs({ limit = 100, offset = 0, accion, admin_id } = {}) {
  let query = db('audit_logs')
    .leftJoin('admins', 'admins.id', 'audit_logs.admin_id')
    .select('audit_logs.*', 'admins.name as admin_name_ref')
    .orderBy('audit_logs.created_at', 'desc')
    .limit(limit).offset(offset);
  if (accion) query = query.where('audit_logs.accion', accion);
  if (admin_id) query = query.where('audit_logs.admin_id', admin_id);
  return query;
}

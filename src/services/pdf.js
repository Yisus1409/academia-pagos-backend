/**
 * Servicio de generación de PDF — Facturas y Solvencias
 * Usa pdfkit para generar PDFs en memoria
 */
import PDFDocument from 'pdfkit';

// ─── Factura de Pago ──────────────────────────────────────────────────────────
export function generarFacturaPDF({ pago, representante, cargos, config }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const primario = config?.color_primario || '#0055E6';
    const inst = config?.nombre || 'Academia';
    const fecha = new Date(pago.pagado_en || pago.created_at).toLocaleDateString('es-VE', { year:'numeric', month:'long', day:'numeric' });

    // Header
    doc.rect(0, 0, doc.page.width, 100).fill(primario);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(22).text(inst, 50, 30);
    doc.font('Helvetica').fontSize(11).text('Factura de Pago', 50, 58);
    doc.fillColor('black');

    // Info factura
    doc.y = 120;
    doc.font('Helvetica-Bold').fontSize(14).fillColor(primario).text(`FACTURA #${String(pago.id).padStart(6,'0')}`, 50, 120);
    doc.font('Helvetica').fontSize(10).fillColor('#666').text(`Fecha: ${fecha}`, 400, 120, { align: 'right' });
    doc.text(`Estado: PAGADO`, 400, 135, { align: 'right' });

    // Línea separadora
    doc.moveTo(50, 160).lineTo(545, 160).strokeColor('#e2e8f0').lineWidth(1).stroke();

    // Datos del representante
    doc.y = 175;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#333').text('DATOS DEL REPRESENTANTE');
    doc.font('Helvetica').fontSize(10).fillColor('#555');
    doc.text(`Nombre: ${representante.nombre_completo}`, { indent: 10 });
    doc.text(`C.I.: ${representante.cedula}`, { indent: 10 });
    if (representante.email) doc.text(`Email: ${representante.email}`, { indent: 10 });
    if (representante.telefono) doc.text(`Teléfono: ${representante.telefono}`, { indent: 10 });

    // Tabla de cargos
    doc.y += 20;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#333').text('DETALLE DE SERVICIOS PAGADOS');
    doc.y += 8;

    // Cabecera tabla
    doc.rect(50, doc.y, 495, 25).fill('#f4f7fc');
    doc.fillColor('#333').font('Helvetica-Bold').fontSize(9);
    const yHeader = doc.y + 8;
    doc.text('CONCEPTO', 60, yHeader);
    doc.text('INSCRITO', 200, yHeader);
    doc.text('MES', 340, yHeader);
    doc.text('MONTO', 460, yHeader, { width: 80, align: 'right' });
    doc.y += 25;

    // Filas
    let subtotal = 0;
    cargos.forEach((c, i) => {
      const y = doc.y;
      if (i % 2 === 0) doc.rect(50, y, 495, 22).fill('#fafafa');
      doc.fillColor('#444').font('Helvetica').fontSize(9);
      doc.text(c.concepto || 'Mensualidad', 60, y + 6, { width: 130 });
      doc.text(c.inscrito_nombre || '—', 200, y + 6, { width: 130 });
      doc.text(c.mes || '—', 340, y + 6, { width: 110 });
      doc.text(`$${Number(c.monto_usd).toFixed(2)}`, 460, y + 6, { width: 80, align: 'right' });
      subtotal += Number(c.monto_usd);
      doc.y += 22;
    });

    // Total
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke();
    doc.y += 8;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(primario);
    doc.text(`TOTAL PAGADO: $${Number(pago.monto_usd).toFixed(2)} USD`, 50, doc.y, { align: 'right' });

    // Método de pago
    doc.y += 25;
    doc.font('Helvetica').fontSize(9).fillColor('#888');
    if (pago.tipo === 'spidi') doc.text('Método de pago: SPIDI (Pago electrónico)');
    else if (pago.tipo === 'manual') doc.text(`Método de pago: Transferencia bancaria — Ref: ${pago.referencia_manual || '—'} — Banco: ${pago.banco_origen || '—'}`);
    else doc.text('Método de pago: Confirmación administrativa');

    // Footer
    doc.y = doc.page.height - 80;
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke();
    doc.y += 10;
    doc.font('Helvetica').fontSize(8).fillColor('#aaa');
    doc.text(`${inst} · Sistema de Pagos Automatizado · Documento generado el ${new Date().toLocaleDateString('es-VE')}`, { align: 'center' });
    doc.text(`Este documento es un comprobante oficial de pago. Código: PAY-${pago.id}-${Date.now().toString(36).toUpperCase()}`, { align: 'center' });

    doc.end();
  });
}

// ─── Solvencia PDF ────────────────────────────────────────────────────────────
export function generarSolvenciaPDF({ representante, inscritos, config, codigo, fecha }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const primario = config?.color_primario || '#0055E6';
    const inst = config?.nombre || 'Academia';

    doc.rect(0, 0, doc.page.width, 100).fill(primario);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(22).text(inst, 50, 30);
    doc.font('Helvetica').fontSize(11).text('Constancia de Solvencia', 50, 58);
    doc.fillColor('black');

    doc.y = 130;
    doc.font('Helvetica-Bold').fontSize(16).fillColor(primario).text('CONSTANCIA DE SOLVENCIA', { align: 'center' });
    doc.y += 20;
    doc.font('Helvetica').fontSize(11).fillColor('#333');
    doc.text(`La institución ${inst} certifica que el representante:`, { align: 'center' });
    doc.y += 15;
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#0A1628').text(representante.nombre_completo, { align: 'center' });
    doc.font('Helvetica').fontSize(11).fillColor('#555').text(`C.I.: ${representante.cedula}`, { align: 'center' });
    doc.y += 20;
    doc.font('Helvetica').fontSize(11).fillColor('#333').text('Se encuentra SOLVENTE en el pago de sus obligaciones a la fecha de emisión de este documento, para los siguientes inscritos:', { align: 'center' });
    doc.y += 15;

    inscritos.forEach(ins => {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(primario).text(`• ${ins.nombre_completo}`, { indent: 100 });
      doc.font('Helvetica').fontSize(9).fillColor('#666').text(`Sección: ${ins.seccion_categoria || '—'} · Contrato: ${ins.numero_contrato}`, { indent: 120 });
      doc.y += 4;
    });

    doc.y += 20;
    doc.rect(100, doc.y, 395, 50).fill('#e6f7f1');
    doc.fillColor('#00A86B').font('Helvetica-Bold').fontSize(16).text('✓ SOLVENTE', 100, doc.y + 15, { width: 395, align: 'center' });
    doc.y += 60;
    doc.font('Helvetica').fontSize(10).fillColor('#888').text(`Fecha de emisión: ${fecha}`, { align: 'center' });
    doc.text(`Código de verificación: ${codigo}`, { align: 'center' });

    doc.y = doc.page.height - 80;
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke();
    doc.y += 10;
    doc.font('Helvetica').fontSize(8).fillColor('#aaa').text(`${inst} · Documento generado el ${fecha}`, { align: 'center' });

    doc.end();
  });
}

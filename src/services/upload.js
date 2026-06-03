import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, '../../../uploads');

// Crear directorios si no existen
['avatares', 'comprobantes'].forEach(dir => {
  const p = path.join(UPLOAD_DIR, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tipo = req.params.tipo || 'comprobantes';
    const dir = ['avatares', 'comprobantes'].includes(tipo) ? tipo : 'comprobantes';
    cb(null, path.join(UPLOAD_DIR, dir));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Tipo de archivo no permitido'), false);
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

export const getFileUrl = (tipo, filename) =>
  `/uploads/${tipo}/${filename}`;

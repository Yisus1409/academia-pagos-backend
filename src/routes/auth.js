import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../database.js';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }

  const admin = await db('admins').where({ email }).first();

  if (!admin) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const valid = bcrypt.compareSync(password, admin.password);
  if (!valid) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const token = jwt.sign(
    { id: admin.id, email: admin.email, name: admin.name },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    token,
    admin: { id: admin.id, name: admin.name, email: admin.email }
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ admin: { id: decoded.id, name: decoded.name, email: decoded.email } });
  } catch {
    res.status(403).json({ error: 'Token inválido' });
  }
});

export default router;

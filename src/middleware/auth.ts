import type { Request, Response, NextFunction } from 'express';
import { verifyAuthToken } from '../lib/auth-utils.ts';
import { getTeamMemberById } from '../db/queries.ts';
import type { User } from '../../types.ts';

export interface AuthRequest extends Request {
  staffUser?: User;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول أولاً.' });
  }

  const token = authHeader.split('Bearer ')[1];
  const payload = verifyAuthToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مجدداً.' });
  }

  try {
    const user = await getTeamMemberById(payload.userId);
    if (!user) {
      return res.status(401).json({ error: 'الحساب غير موجود.' });
    }
    if (user.isSuspended) {
      return res.status(403).json({ error: 'هذا الحساب معطل حالياً من قبل الإدارة.' });
    }
    req.staffUser = user;
    next();
  } catch (error) {
    console.error('Error verifying session user:', error);
    return res.status(500).json({ error: 'حدث خطأ أثناء التحقق من الحساب.' });
  }
};

import type { Request, Response, NextFunction } from 'express';
import { verifyAuthToken, verifyOwnerStepUpToken, verifyPassword } from '../lib/auth-utils.ts';
import { withDbRetry } from '../db/index.ts';
import { getTeamMemberById, getTeamMemberPasswordHashById } from '../db/queries.ts';
import type { User, UserRole } from '../../types.ts';

export interface AuthRequest extends Request {
  staffUser?: User;
}

export function isPrivilegedManagerRole(role?: UserRole | string | null): boolean {
  return role === 'owner' || role === 'admin';
}

export function isOwnerRole(role?: UserRole | string | null): boolean {
  return role === 'owner';
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
    const user = await withDbRetry(() => getTeamMemberById(payload.userId));
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

export const requireOwner = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.staffUser || req.staffUser.role !== 'owner') {
    return res.status(403).json({
      error: 'هذه الصلاحية مخصصة لحساب المالك الرئيسي للنظام (Owner / Super Admin) فقط.',
    });
  }
  next();
};

export const requireOwnerStepUp = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const user = req.staffUser;
  if (!user || user.role !== 'owner') {
    return res.status(403).json({
      error: 'هذه العملية الحساسة مخصصة للمالك الرئيسي للنظام (Owner) فقط.',
    });
  }

  const reauthTokenHeader = req.headers['x-owner-reauth'];
  const reauthToken = typeof reauthTokenHeader === 'string' ? reauthTokenHeader.trim() : '';

  if (reauthToken && verifyOwnerStepUpToken(reauthToken, user.id)) {
    return next();
  }

  const confirmPassword =
    typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';
  if (confirmPassword) {
    const storedHash = await withDbRetry(() => getTeamMemberPasswordHashById(user.id));
    if (storedHash && verifyPassword(confirmPassword, storedHash)) {
      return next();
    }
    return res.status(403).json({
      error: 'كلمة مرور تأكيد هوية المالك غير صحيحة.',
      requiresOwnerReauth: true,
    });
  }

  return res.status(428).json({
    error: 'تتطلب هذه العملية الحساسة إعادة تأكيد هوية المالك الرئيسي أولاً.',
    requiresOwnerReauth: true,
  });
};

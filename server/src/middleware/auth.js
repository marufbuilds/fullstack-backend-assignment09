 
import { fromNodeHeaders } from 'better-auth/node';
import { getAuth } from '../auth.js';

export async function authenticate(req, res, next) {
  try {
    const session = await getAuth().api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user?.id) {
      return res.status(401).json({
        message: 'Authentication required',
      });
    }

    const userId = String(session.user.id).trim();
    const role = String(session.user.role || 'customer')
      .trim()
      .toLowerCase();

    req.user = {
      ...session.user,
      _id: userId,
      id: userId,
      role,
    };

    req.session = session.session;

    return next();
  } catch (error) {
    return next(error);
  }
}

export const allowRoles = (...roles) => (req, res, next) => {
  const userRole = String(req.user?.role || '').trim().toLowerCase();

  if (!userRole || !roles.map((r) => String(r).toLowerCase()).includes(userRole)) {
    return res.status(403).json({
      message: 'Forbidden',
    });
  }

  return next();
};
 
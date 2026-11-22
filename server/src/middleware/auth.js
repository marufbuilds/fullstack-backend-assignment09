 
import { fromNodeHeaders } from 'better-auth/node';
import { getAuth } from '../auth.js';

export async function authenticate(req, res, next) {
  try {
    const session = await getAuth().api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Use the verified Better Auth session user.
    req.user = {
      ...session.user,
      _id: session.user.id,
      role: session.user.role || 'customer',
    };

    req.session = session.session;

    return next();
  } catch (error) {
    return next(error);
  }
}

export const allowRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  return next();
};

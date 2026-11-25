 
import { fromNodeHeaders } from "better-auth/node";
import { ObjectId } from "mongodb";
import { getAuth } from "../auth.js";
import { getDB } from "../db.js";

export async function authenticate(req, res, next) {
  try {
    const session = await getAuth().api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user?.id) {
      return res.status(401).json({
        message: "Authentication required",
      });
    }

    const userId = String(session.user.id);
    const db = getDB();

    // Find the user using either string ID, ObjectId, or email.
    const conditions = [{ _id: userId }];

    if (ObjectId.isValid(userId)) {
      conditions.push({ _id: new ObjectId(userId) });
    }

    if (session.user.email) {
      conditions.push({
        email: session.user.email.toLowerCase(),
      });
    }

    const dbUser = await db.collection("users").findOne({
      $or: conditions,
    });

    const role = String(
      dbUser?.role || session.user.role || "customer"
    )
      .toLowerCase()
      .trim();

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
  const userRole = String(req.user?.role || "")
    .trim()
    .toLowerCase();

  const allowedRoles = roles.map((role) =>
    String(role).trim().toLowerCase()
  );

  if (!userRole || !allowedRoles.includes(userRole)) {
    return res.status(403).json({
      message: "You do not have permission to perform this action.",
    });
  }

  return next();
};

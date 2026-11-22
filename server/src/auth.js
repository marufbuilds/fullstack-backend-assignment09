 
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { getDB } from './db.js';

let authInstance;

export function createAuth() {
  const baseURL = (
    process.env.BETTER_AUTH_URL || `http://localhost:${process.env.PORT || 5000}`
  ).replace(/\/+$/, '');

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  const socialProviders = {};

  if (googleClientId && googleClientSecret) {
    socialProviders.google = {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      redirectURI:
        process.env.GOOGLE_REDIRECT_URI ||
        `${baseURL}/api/auth/callback/google`,
      prompt: 'select_account'
    };

    console.log('Google authentication configured');
  } else {
    console.warn('Google authentication is disabled: credentials are missing');
  }

  authInstance = betterAuth({
    database: mongodbAdapter(getDB()),

    secret: process.env.BETTER_AUTH_SECRET,
    baseURL,

    trustedOrigins: (process.env.CLIENT_URL || 'http://localhost:3000')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128
    },

    socialProviders,

    user: {
      modelName: 'users',
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'customer',
          input: false
        }
      }
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24
    }
  });

  return authInstance;
}

export function getAuth() {
  if (!authInstance) {
    throw new Error('Better Auth has not been initialized');
  }

  return authInstance;
}

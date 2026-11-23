import { RequestHandler } from 'express';

export const authenticate: RequestHandler;

export function allowRoles(...roles: string[]): RequestHandler;
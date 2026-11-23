import { Db } from 'mongodb';

export function connectDB(): Promise<Db>;
export function getDB(): Db;
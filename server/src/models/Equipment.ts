 
import type { ObjectId } from 'mongodb';

export interface Equipment {
  _id?: ObjectId;
  title: string;
  description: string;
  category: string;
  price: number;
  location: string;
  images?: string[];
  ownerId: string;
  status: 'available' | 'rented' | 'unavailable';
  createdAt?: Date;
  updatedAt?: Date;
}

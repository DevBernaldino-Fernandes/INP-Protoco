import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Execution } from './entities/Execution';
import { ServiceRegistration } from './entities/ServiceRegistration';
import dotenv from 'dotenv';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER || 'inp',
  password: process.env.DB_PASSWORD || 'inp123',
  database: process.env.DB_NAME || 'inp',
  synchronize: true,   // set false in production with migrations
  logging: false,
  entities: [Execution, ServiceRegistration],
});
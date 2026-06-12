import { AppDataSource } from '../data-source';
import { ServiceRegistration } from '../entities/ServiceRegistration';

export const ServiceRepository = AppDataSource.getRepository(ServiceRegistration);
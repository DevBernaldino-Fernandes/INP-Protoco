import { AppDataSource } from '../data-source';
import { Execution } from '../entities/Execution';

export const ExecutionRepository = AppDataSource.getRepository(Execution);